#!/usr/bin/env bash
# Sudoers untuk apply-mikhmon-domain.sh (Domain & SSL Mikhmon)
najwa ALL=(root) NOPASSWD: /opt/mikrotik-billing/deploy/apply-mikhmon-domain.sh
najwa ALL=(root) NOPASSWD: /usr/bin/certbot
najwa ALL=(root) NOPASSWD: /bin/systemctl reload nginx
najwa ALL=(root) NOPASSWD: /usr/sbin/nginx -t
najwa ALL=(root) NOPASSWD: /bin/systemctl reload php*-fpm
