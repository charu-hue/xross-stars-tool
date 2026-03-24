import json
import os
import sqlite3
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from flask import Flask, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

DB_PATH = os.getenv("DB_PATH", str(DATA_DIR / "app.db"))

CARDS_JSON_PATH = DATA_DIR / "cards.json"
DECKS_JSON_PATH = DATA_DIR / "decks.json"

app = Flask(__name__, template_folder="templates", static_folder="static")


def generate_id() -> str:
    return str(uuid.uuid4())


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    ).fetchone()
    return row is not None


def init_db() -> None:
    conn = get_connection()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cards (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                color TEXT,
                cost INTEGER DEFAULT 0,
                atk INTEGER DEFAULT 0,
                hp INTEGER DEFAULT 0,
                awaken_atk INTEGER,
                awaken_hp INTEGER,
                effect TEXT DEFAULT '',
                image_url TEXT,
                awaken_image_url TEXT,
                tactics_type TEXT,
                original_id TEXT,
                raw_json TEXT
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS decks (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                source TEXT DEFAULT 'manual',
                leaders_json TEXT NOT NULL,
                main_deck_json TEXT NOT NULL,
                tactics_json TEXT NOT NULL,
                pp_card_json TEXT,
                image_url TEXT,
                raw_json TEXT
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def load_json_file(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        return []
    except Exception:
        return []


def normalize_card_for_front(card: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(card.get("id") or generate_id()),
        "originalId": card.get("originalId"),
        "name": card.get("name", ""),
        "type": card.get("type", "memoria"),
        "color": card.get("color", "colorless"),
        "cost": int(card.get("cost") or 0),
        "atk": int(card.get("atk") or 0),
        "hp": int(card.get("hp") or 0),
        "awakenAtk": int(card.get("awakenAtk") or 0) if card.get("awakenAtk") is not None else None,
        "awakenHp": int(card.get("awakenHp") or 0) if card.get("awakenHp") is not None else None,
        "effect": card.get("effect", ""),
        "imageUrl": card.get("imageUrl"),
        "awakenImageUrl": card.get("awakenImageUrl"),
        "tactics_type": card.get("tactics_type"),
        "tacticsType": card.get("tacticsType") or card.get("tactics_type"),
    }


def normalize_card_from_import(card: Dict[str, Any]) -> Dict[str, Any]:
    internal_type = (card.get("card_type") or {}).get("internal_id", "")
    if internal_type == "leader":
        card_type = "leader"
    elif internal_type == "attack":
        card_type = "attack"
    elif internal_type == "memoria":
        card_type = "memoria"
    elif internal_type == "tactics":
        # PPチケットは別扱いにしたいので family/name で判定
        if card.get("name") == "PPチケット":
            card_type = "pp_ticket"
        else:
            card_type = "tactics"
    else:
        card_type = "memoria"

    color = ((card.get("card_color") or {}).get("internal_id")) or "colorless"

    normalized = {
        "id": generate_id(),
        "originalId": str(card.get("id")) if card.get("id") is not None else None,
        "name": card.get("name", ""),
        "type": card_type,
        "color": color,
        "cost": int(card.get("cost") or 0),
        "atk": int(card.get("atk") or 0),
        "hp": int(card.get("hp") or 0),
        "awakenAtk": int(card.get("awaken_atk") or 0) if card.get("awaken_atk") is not None else None,
        "awakenHp": int(card.get("awaken_hp") or 0) if card.get("awaken_hp") is not None else None,
        "effect": card.get("effect", ""),
        "imageUrl": card.get("image_url"),
        "awakenImageUrl": card.get("awaken_image_url"),
        "tactics_type": card.get("tactics_type"),
        "tacticsType": card.get("tactics_type"),
    }
    return normalized


def row_to_card(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "originalId": row["original_id"],
        "name": row["name"],
        "type": row["type"],
        "color": row["color"],
        "cost": row["cost"] if row["cost"] is not None else 0,
        "atk": row["atk"] if row["atk"] is not None else 0,
        "hp": row["hp"] if row["hp"] is not None else 0,
        "awakenAtk": row["awaken_atk"],
        "awakenHp": row["awaken_hp"],
        "effect": row["effect"] or "",
        "imageUrl": row["image_url"],
        "awakenImageUrl": row["awaken_image_url"],
        "tactics_type": row["tactics_type"],
        "tacticsType": row["tactics_type"],
    }


def row_to_deck(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "source": row["source"] or "manual",
        "leaders": json.loads(row["leaders_json"] or "[]"),
        "mainDeck": json.loads(row["main_deck_json"] or "[]"),
        "tactics": json.loads(row["tactics_json"] or "[]"),
        "ppCard": json.loads(row["pp_card_json"]) if row["pp_card_json"] else None,
        "imageUrl": row["image_url"],
    }


def save_card(conn: sqlite3.Connection, card: Dict[str, Any]) -> Dict[str, Any]:
    normalized = normalize_card_for_front(card)
    conn.execute(
        """
        INSERT OR REPLACE INTO cards (
            id, name, type, color, cost, atk, hp, awaken_atk, awaken_hp,
            effect, image_url, awaken_image_url, tactics_type, original_id, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            normalized["id"],
            normalized["name"],
            normalized["type"],
            normalized["color"],
            normalized["cost"],
            normalized["atk"],
            normalized["hp"],
            normalized["awakenAtk"],
            normalized["awakenHp"],
            normalized["effect"],
            normalized["imageUrl"],
            normalized["awakenImageUrl"],
            normalized["tactics_type"],
            normalized["originalId"],
            json.dumps(normalized, ensure_ascii=False),
        ),
    )
    return normalized


def save_deck(conn: sqlite3.Connection, deck: Dict[str, Any]) -> Dict[str, Any]:
    deck_id = str(deck.get("id") or generate_id())
    normalized = {
        "id": deck_id,
        "name": deck.get("name", "無名デッキ"),
        "source": deck.get("source", "manual"),
        "leaders": deck.get("leaders", []),
        "mainDeck": deck.get("mainDeck", []),
        "tactics": deck.get("tactics", []),
        "ppCard": deck.get("ppCard"),
        "imageUrl": deck.get("imageUrl"),
    }

    conn.execute(
        """
        INSERT OR REPLACE INTO decks (
            id, name, source, leaders_json, main_deck_json, tactics_json,
            pp_card_json, image_url, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            normalized["id"],
            normalized["name"],
            normalized["source"],
            json.dumps(normalized["leaders"], ensure_ascii=False),
            json.dumps(normalized["mainDeck"], ensure_ascii=False),
            json.dumps(normalized["tactics"], ensure_ascii=False),
            json.dumps(normalized["ppCard"], ensure_ascii=False) if normalized["ppCard"] else None,
            normalized["imageUrl"],
            json.dumps(normalized, ensure_ascii=False),
        ),
    )
    return normalized


def migrate_json_to_db_if_needed() -> None:
    conn = get_connection()
    try:
        cards_count = conn.execute("SELECT COUNT(*) AS cnt FROM cards").fetchone()["cnt"]
        decks_count = conn.execute("SELECT COUNT(*) AS cnt FROM decks").fetchone()["cnt"]

        # すでにDBにデータがあるなら移行不要
        if cards_count > 0 or decks_count > 0:
            return

        json_cards = load_json_file(CARDS_JSON_PATH)
        json_decks = load_json_file(DECKS_JSON_PATH)

        for card in json_cards:
            save_card(conn, card)

        for deck in json_decks:
            save_deck(conn, deck)

        conn.commit()
    finally:
        conn.close()


def extract_deck_code(input_value: str) -> Optional[str]:
    value = (input_value or "").strip()
    if not value:
        return None

    if "deck=" in value:
        # 例: https://xross-stars.com/deck/new?deck=xxxx
        return value.split("deck=")[-1].split("&")[0].strip()

    if "/deck/" in value:
        # 例: https://xross-stars.com/deck/xxxx
        return value.rstrip("/").split("/")[-1].strip()

    return value


def import_deck_from_xross_stars(deck_code: str) -> Dict[str, Any]:
    api_url = f"https://api.xross-stars.com/v1/decks/{deck_code}"
    response = requests.get(api_url, timeout=20)
    response.raise_for_status()
    data = response.json()

    leaders = [normalize_card_from_import(c) for c in data.get("leader", [])]
    main_deck = [normalize_card_from_import(c) for c in data.get("deck", [])]
    tactics_raw = data.get("tactics", [])
    tactics = [
        normalize_card_from_import(c)
        for c in tactics_raw
        if c.get("name") != "PPチケット"
    ]

    pp_card_raw = data.get("pp")
    pp_card = normalize_card_from_import(pp_card_raw) if pp_card_raw else None

    deck_name = f"Imported Deck {deck_code[:8]}"

    return {
        "id": generate_id(),
        "name": deck_name,
        "source": "imported",
        "leaders": leaders,
        "mainDeck": main_deck,
        "tactics": tactics,
        "ppCard": pp_card,
        "imageUrl": data.get("image_url"),
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/cards")
def get_cards():
    conn = get_connection()
    try:
        rows = conn.execute("SELECT * FROM cards ORDER BY name ASC").fetchall()
        return jsonify([row_to_card(row) for row in rows])
    finally:
        conn.close()


@app.post("/api/cards")
def create_card():
    payload = request.get_json(silent=True) or {}

    if not payload.get("name"):
        return jsonify({"error": "カード名は必須です。"}), 400

    card = {
        "id": generate_id(),
        "name": payload.get("name", "").strip(),
        "type": payload.get("type", "memoria"),
        "color": payload.get("color", "colorless"),
        "cost": int(payload.get("cost") or 0),
        "atk": int(payload.get("atk") or 0),
        "hp": int(payload.get("hp") or 0),
        "awakenAtk": payload.get("awakenAtk"),
        "awakenHp": payload.get("awakenHp"),
        "effect": payload.get("effect", ""),
        "imageUrl": payload.get("imageUrl"),
        "awakenImageUrl": payload.get("awakenImageUrl"),
        "tactics_type": payload.get("tactics_type") or payload.get("tacticsType"),
        "originalId": payload.get("originalId"),
    }

    conn = get_connection()
    try:
        saved = save_card(conn, card)
        conn.commit()
        return jsonify(saved), 201
    finally:
        conn.close()


@app.delete("/api/cards/<card_id>")
def delete_card(card_id: str):
    conn = get_connection()
    try:
        conn.execute("DELETE FROM cards WHERE id = ?", (card_id,))
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.get("/api/decks")
def get_decks():
    conn = get_connection()
    try:
        rows = conn.execute("SELECT * FROM decks ORDER BY rowid DESC").fetchall()
        return jsonify([row_to_deck(row) for row in rows])
    finally:
        conn.close()


@app.post("/api/decks")
def create_deck():
    payload = request.get_json(silent=True) or {}

    if not payload.get("name"):
        return jsonify({"error": "デッキ名は必須です。"}), 400

    deck = {
        "id": generate_id(),
        "name": payload.get("name", "").strip(),
        "source": payload.get("source", "manual"),
        "leaders": payload.get("leaders", []),
        "mainDeck": payload.get("mainDeck", []),
        "tactics": payload.get("tactics", []),
        "ppCard": payload.get("ppCard"),
        "imageUrl": payload.get("imageUrl"),
    }

    conn = get_connection()
    try:
        saved = save_deck(conn, deck)
        conn.commit()
        return jsonify(saved), 201
    finally:
        conn.close()


@app.delete("/api/decks/<deck_id>")
def delete_deck(deck_id: str):
    conn = get_connection()
    try:
        conn.execute("DELETE FROM decks WHERE id = ?", (deck_id,))
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.post("/api/import-deck")
def import_deck():
    payload = request.get_json(silent=True) or {}
    input_value = payload.get("input", "")

    deck_code = extract_deck_code(input_value)
    if not deck_code:
        return jsonify({"error": "デッキコードまたはURLを入力してください。"}), 400

    try:
        imported_deck = import_deck_from_xross_stars(deck_code)
    except requests.HTTPError as e:
        return jsonify({"error": f"公式デッキ取得に失敗しました: {e.response.status_code}"}), 400
    except requests.RequestException:
        return jsonify({"error": "公式サイトへの接続に失敗しました。"}), 502
    except Exception as e:
        return jsonify({"error": f"デッキ取込中にエラーが発生しました: {str(e)}"}), 500

    conn = get_connection()
    try:
        saved = save_deck(conn, imported_deck)
        conn.commit()
        return jsonify(saved), 201
    finally:
        conn.close()


def startup() -> None:
    init_db()
    migrate_json_to_db_if_needed()


startup()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)