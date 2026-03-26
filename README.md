# Xross-Stars Solo Practice Tool

## 概要
本アプリは、カードゲーム「Xross-Stars」の一人回し練習を目的としたWebアプリケーションです。  
1つの画面上で2つのデッキを操作できるようにし、対戦の流れや盤面確認を1人で行いやすくすることを目的として作成しました。

通常の対戦では相手プレイヤーが必要になりますが、本アプリでは1人で両方のデッキを操作できるため、特定の盤面や手順の確認を効率的に行うことができます。

---

## アプリURL
http://98.82.224.48/


主な機能
2つのデッキを1画面で操作できる一人回し対戦機能
カード登録機能
デッキ作成機能
公式デッキコード / URL からのデッキ取込機能
タクティクスエリアのモーダル表示
使用済みタクティクス表示
装備タクティクスの装備先選択
SQLiteによるカード・デッキ保存
使用技術
バックエンド
Python
Flask
フロントエンド
HTML
CSS
JavaScript
データベース
SQLite
インフラ・開発環境
Docker
Docker Compose
AWS EC2
GitHub
VSCode
工夫した点
1. 一人回しに特化したUI

1画面で2つのデッキを操作できるようにし、実際の対戦練習に近い形で使えるようにしました。

2. ツール向けにルールを整理した点

実際のルールではダメージカウンターを使いますが、本アプリでは練習中の見やすさを優先してHPを直接増減する方式にしました。

3. タクティクスエリアのモーダル化

タクティクスを常時画面に表示すると見づらくなるため、必要なときだけ開けるモーダル表示にしました。

4. 装備タクティクスへの対応

装備タクティクス使用時には、装備先リーダーを選択できるようにし、通常タクティクスと分けて処理しました。

5. JSON保存からSQLite保存へ変更した点

途中まではJSONで保存していましたが、課題提出と今後の拡張を考慮してSQLiteへ移行しました。

6. Docker + EC2で公開した点

ローカルだけでなく、Dockerを利用してAWS EC2上で動作するようにし、外部からアクセス可能な形にしました。

苦労した点
1. 状態管理の複雑さ

2つのデッキを同時に操作するため、山札、手札、トラッシュ、PP、リーダー状態、タクティクス状態を分けて管理する必要がありました。

2. タクティクス処理の分岐

通常タクティクス、装備タクティクス、PPチケットで動きが異なるため、処理を分けて管理する必要がありました。

3. 保存方式の変更

途中で保存形式をJSONからSQLiteに変更したため、既存処理をデータベースに対応させる必要がありました。

4. EC2デプロイ環境の構築

Docker Compose の実行環境や権限周りでつまずいたため、ローカルとEC2の差を確認しながら進めました。

今後の改善点
装備タクティクスの継続効果の厳密な実装
カード効果自動処理の精度向上
UIの改善
対戦ログ保存機能の追加
ルール処理のさらなる精密化
ディレクトリ構成
xross-stars-tool/
├─ app.py
├─ requirements.txt
├─ Dockerfile
├─ docker-compose.yml
├─ .dockerignore
├─ README.md
├─ data/
│  └─ app.db
├─ templates/
│  └─ index.html
└─ static/
   ├─ app.js
   └─ style.css
ローカル起動方法
1. リポジトリを取得
git clone https://github.com/charu-hue/xross-stars-tool.git
cd xross-stars-tool
2. Dockerイメージを作成
docker build -t xross-stars-tool-web .
3. コンテナを起動
docker compose up -d
4. ブラウザで確認
http://localhost
EC2デプロイ手順
1. EC2インスタンスを作成
Amazon Linux 2023 を使用
セキュリティグループで SSH(22) と HTTP(80) を許可
2. EC2へSSH接続
ssh -i "キーペア.pem" ec2-user@<EC2のパブリックIP>
3. Dockerをインストール
sudo yum update -y
sudo yum install -y docker
sudo service docker start
sudo usermod -aG docker ec2-user
4. Gitをインストール
sudo yum install -y git
5. Docker Composeを利用できるようにする

手動でDocker Compose pluginを導入しました。

mkdir -p ~/.docker/cli-plugins
curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 -o ~/.docker/cli-plugins/docker-compose
chmod +x ~/.docker/cli-plugins/docker-compose
docker compose version
6. GitHubからソースコードを取得
git clone https://github.com/charu-hue/xross-stars-tool.git
cd xross-stars-tool
7. Dockerイメージを作成
docker build -t xross-stars-tool-web .
8. コンテナを起動
docker compose up -d
9. Elastic IPを関連付けてアクセス

EC2にElastic IPを関連付け、ブラウザから以下にアクセスして動作確認を行いました。

http://<Elastic IP>
GitHub更新手順
ローカル側
git add .
git commit -m "update"
git push
EC2側
git pull
docker build -t xross-stars-tool-web .
docker compose up -d
制作背景

このアプリは、カードゲーム「Xross-Stars」において、1人で効率的に練習できる環境を作りたいと考えたことがきっかけです。
既存の汎用ツールではゲーム特有のルールや挙動を十分に再現しづらいため、専用の練習ツールを作成しました。