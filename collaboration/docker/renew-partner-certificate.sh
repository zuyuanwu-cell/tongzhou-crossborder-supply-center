#!/bin/bash
set -eu

cd /www/server/panel
btpython -u class/acme_v2.py \
  --renew=1 \
  --index='35c57860bd30de69040b6604d8ec9271' \
  --cycle=30

/www/server/nginx/sbin/nginx -t
/www/server/nginx/sbin/nginx -s reload
