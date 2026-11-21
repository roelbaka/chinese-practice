# php-fpm for the backend in /api and /auth: Redis sessions (phpredis) and SQLite (built in).
FROM php:8.3-fpm-alpine

RUN apk add --no-cache --virtual .build-deps $PHPIZE_DEPS \
 && pecl install -o -f redis \
 && docker-php-ext-enable redis \
 && apk del .build-deps \
 && rm -rf /tmp/pear

COPY php.ini /usr/local/etc/php/conf.d/zz-app.ini
COPY pool.conf /usr/local/etc/php-fpm.d/zz-app.conf
