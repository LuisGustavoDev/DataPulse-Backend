#!/bin/sh
# Cria os buckets, o CORS (upload direto do navegador) e as regras de expiração.
set -e
S3="aws --endpoint-url http://storage:9000 s3api"

until $S3 list-buckets >/dev/null 2>&1; do
  echo "aguardando o storage..."; sleep 2
done

for bucket in dp-incoming dp-archive; do
  $S3 head-bucket --bucket "$bucket" 2>/dev/null || $S3 create-bucket --bucket "$bucket"
done

$S3 put-bucket-cors --bucket dp-incoming --cors-configuration file:///config/cors.json
$S3 put-bucket-lifecycle-configuration --bucket dp-incoming --lifecycle-configuration file:///config/lifecycle-incoming.json
$S3 put-bucket-lifecycle-configuration --bucket dp-archive --lifecycle-configuration file:///config/lifecycle-archive.json
echo "storage pronto"
