# Лендинг Loginom Dock

Публичный сайт: <https://loginom-dock.duckdns.org/>. Инструкция и интерфейс — на
русском языке. Endpoint клиента остаётся `https://loginom.duckdns.org/mcp`.
Текущие образы, точный Compose и откат — в
[руководстве эксплуатации](../docs/loginom-dock/operations.md).

Статический HTML/CSS/JS без внешних скриптов и зависимостей. `release.json` задаёт
опубликованный выпуск, платформы и контрольные суммы; `build.mjs` проверяет эти
данные и формирует `dist/`. `instructions.mjs` связывает выбранные агент и систему
с одним архивом, суммой и набором команд. Исходная страница без JavaScript
содержит установку Codex/macOS и ссылки на полную инструкцию и Linux.

## Сборка на сервере

Из корня checkout на VPS:

```sh
docker build -f deploy/loginom-dock/Dockerfile.landing \
  --build-arg LOGINOM_DOCK_REVISION=FULL_COMMIT_SHA \
  -t loginom-dock:landing-COMMIT .
```

Builder Node и финальный Caddy закреплены digest в Dockerfile. Статика входит
в образ по пути `/srv/loginom-dock-landing`; generated `dist/` не входит в Git
и Docker build context. Перед развёртыванием проверить новый `Caddyfile.server`
командой `caddy validate` из собранного образа. Затем указать образ в
`LOGINOM_DOCK_CADDY_IMAGE` собственного `deploy.env` и пересоздать Caddy через
серверный Compose. Существующие TLS-тома сохраняются. Для отката вернуть
предыдущий образ и Caddyfile. Обычная резервная копия уже сохраняет образ Caddy.

Ссылки `/studio/connect` перенаправляются на `/#install` нового домена: Caddy
обрабатывает прямой запрос, маршрут Studio — переход внутри приложения.
При изменении этого маршрута нужно также собрать и развернуть Studio.

Перед публикацией: проверки селекторов в `client/test/landing.test.mjs`, серверная
сборка, визуальный просмотр сайта на широком и узком экране, проверка четырёх
сочетаний агента/системы, копирования, ссылок выпуска, примеров, HTTPS и старого
адреса. Публичные инструкции сверять с `client/INSTALL.md` и реализацией мастера.
Не заменять ими отложенную приёмку чистой установки.

`landing/release.json` — источник публичных ссылок и SHA-256. Для нового выпуска
обновлять его только после проверки GitHub assets, затем пересобирать Caddy image.
`web-studio/src/lib/dock-release.ts` остался от прежней страницы и больше не управляет
загрузками: маршрут Studio теперь перенаправляет на лендинг.

## Фирменный стиль и лицензии

- Палитра: [официальный брендбук Loginom](https://brandbook.loginom.ru/color/),
  основной `#A23938`, тёмный `#7D2B29`, текст `#333333`.
- Шрифт: [Source Sans Pro из брендбука](https://brandbook.loginom.ru/typographics/),
  неизменённые WOFF2 Regular, Semibold и Bold; OFL включена в
  `assets/LICENSE-SourceSansPro.txt`. Шрифты загружаются с самого сайта.
- `dock-mark.svg` — отдельный знак интерфейса Dock; он не подменяет логотип Loginom.
- `sales.csv` — простой пример из трёх строк; ожидаемые суммы 20, 15, 28.

Ключей, учётных записей и форм отправки данных на лендинге нет. Описание общей
базы и границ архивации соответствует архитектуре Dock.
