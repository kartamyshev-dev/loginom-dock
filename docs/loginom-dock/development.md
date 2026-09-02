# Разработка и локальная сборка Dock

## Контейнер

Нужны Docker Engine/BuildKit и Docker Compose v2. `docker compose build` собирает
Studio, Python-сервер, native-библиотеки и CLI из текущего checkout. Нужен доступ
к реестрам образов и зависимостей. Compose передаёт `UV_LOCK_STRATEGY=locked`:
устаревший lock-файл останавливает сборку и не обновляется неявно.

```sh
docker compose build
```

Локальный образ называется `loginom-dock:dev`; версия Python-пакета для этой
разработческой сборки — `0.1.0.dev0`. Это не опубликованный релиз. При подготовке
проверенного образа явно задаются `LOGINOM_DOCK_IMAGE`, `LOGINOM_DOCK_BUILD_VERSION`
и `LOGINOM_DOCK_REVISION` (полный commit SHA). Образ включает OCI-метаданные Dock.

Создайте конфигурацию интерактивно в отдельном томе Dock:

```sh
docker compose run --rm --no-deps openviking openviking-server init
docker compose up -d openviking
docker compose exec openviking openviking-server doctor
```

Мастер использует сохранённый upstream CLI внутри контейнера и пишет
`/app/.openviking/ov.conf`. Укажите отдельные параметры моделей и учётные данные
Dock. Существующий личный `~/.openviking` не подключается. Настройте
`storage.workspace` внутри `/app/.openviking`, чтобы данные попадали в постоянный
том. Не выбирайте путь вне этого тома. При отсутствии конфига entrypoint возвращает
503 и ожидает настройки; такой контейнер не считается готовым.

Адреса после успешного старта:

| Компонент | Локальный адрес |
| --- | --- |
| Studio | `http://127.0.0.1:1933/studio/` |
| MCP | `http://127.0.0.1:1933/mcp` |
| API | `http://127.0.0.1:1933/api/v1/` |
| Health | `http://127.0.0.1:1933/health` |

VikingBot остаётся доступен, но по умолчанию не запускается: задачи Loginom будет
выполнять клиентский агент. Для работы штатного Bot-чата Studio задайте
`LOGINOM_DOCK_WITH_BOT=1` и настройте его провайдер. Это отдельная функция OpenViking.

Дополнительный локальный reverse proxy включается через
`docker compose --profile proxy up -d`; он слушает `127.0.0.1:1934`.
Публичный HTTPS, клиентские ключи общего аккаунта, backup/restore и доступ к GitLab
подготавливаются и проверяются в этапах 2 и 7. Само наличие Caddy не подтверждает
готовность публичного сервиса.

## Настройки и данные

| Переменная Compose | Назначение / значение по умолчанию |
| --- | --- |
| `LOGINOM_DOCK_IMAGE` | Собственный образ, `loginom-dock:dev` |
| `LOGINOM_DOCK_BUILD_VERSION` | Версия сборки Python/CLI, `0.1.0.dev0` |
| `LOGINOM_DOCK_REVISION` | OCI revision, `working-tree` |
| `LOGINOM_DOCK_PORT` | Порт на loopback, `1933` |
| `LOGINOM_DOCK_PROXY_PORT` | Порт локального proxy, `1934` |
| `LOGINOM_DOCK_PUBLIC_BASE_URL` | Публичный origin, пустой до развёртывания |
| `LOGINOM_DOCK_WITH_BOT` | Запуск VikingBot, `0` |

Compose-проект `loginom-dock` владеет томами `dock_data`, `caddy_data`,
`caddy_config`. Обычный `docker compose down` сохраняет тома. Не применяйте `down -v`
к данным, которые должны сохраниться. Внутренние переменные `OPENVIKING_*` служат
адаптером к существующему серверу; они не меняют настройки личного OpenViking.

Локальные credentials, конфиги и Assets State храните в `.dock/` с ограниченными
правами. Каталог исключён из Git и Docker build context. Туда же можно положить
файл переменных и передавать его через `docker compose --env-file .dock/deploy.env`.
Не помещайте credentials в Docker build args, команды, README или архивы сборки.

## Сборка на сервере

Рабочая сборка выполняется на VPS Dock. На VPS с 4 GiB RAM для компиляции
Rust/C++ добавлен отдельный swap-файл `/var/swap.loginom-dock` размером 4 GiB
(0600, запись в `/etc/fstab`). Это резерв сборки; файл не содержит конфигов Dock. Для чистого Ubuntu-сервера предусмотрен
`deploy/loginom-dock/install-docker.sh`, который устанавливает Engine, Buildx и
Compose из [официального apt-репозитория Docker](https://docs.docker.com/engine/install/ubuntu/).
Он требует root, добавляет репозиторий пакетов и запускает службу Docker;
применяется после разрешения администратора. Если Docker уже есть, скрипт только
проверяет версии. Конфигурацию действующей установки он не заменяет.

На сервер передаётся снимок исходников с ревизией и SHA-256, включая ещё не
закоммиченные изменения. `.env`, `.dock`, `.git`, локальные зависимости и build
артефакты в снимок не включаются. Сборку запускают из отдельного каталога релиза;
данные и конфиги Dock остаются в постоянном хранилище вне каталога исходников.

### Публичный сервер

Дополнение `deploy/loginom-dock/compose.server.yaml` подключает серверный конфиг,
Ollama и Caddy с HTTPS. Оно применяется **после** корневого Compose, из корня
снимка исходников. Конфиг `/opt/loginom-dock/config/ov.conf` создаётся отдельно
(каталог 0700, файл 0600) и монтируется только для чтения. В нём нужны отдельный
root key, `server.auth_mode: api_key`, публичный origin, параметры моделей и
`storage.workspace: /app/.openviking/workspace`.

Оставьте upstream `default_account`/`default_user` со штатными значениями:
внутренняя AGFS readiness использует default context. Общая identity клиентов
выбирается их ключом, а не заменой этих внутренних defaults. Для импорта общих
ресурсов используйте ключ администратора аккаунта Dock: root key в режиме
`api_key` управляет аккаунтами, но не имеет доступа к их данным.
После атомарной замены `ov.conf` пересоздайте контейнер приложения: bind mount
старого inode не подхватит новый файл при простом `restart`.

В `/opt/loginom-dock/config/deploy.env` указываются `LOGINOM_DOCK_IMAGE`,
`LOGINOM_DOCK_REVISION`, `LOGINOM_DOCK_BUILD_VERSION`, `LOGINOM_DOCK_DOMAIN`,
`LOGINOM_DOCK_PUBLIC_BASE_URL` и проверенный digest `LOGINOM_DOCK_CADDY_IMAGE`.
Образ Ollama закреплён digest в Compose. Ollama доступна только в сети контейнеров;
адрес планировщика в конфиге — `http://ollama:11434`.

```sh
docker compose --env-file /opt/loginom-dock/config/deploy.env \
  -f docker-compose.yml -f deploy/loginom-dock/compose.server.yaml \
  --profile server up -d
python3 deploy/loginom-dock/bootstrap-account.py
python3 deploy/loginom-dock/verify-server.py
```

DNS домена должен указывать на сервер, порты 80/443 — быть доступны для выпуска
сертификата. На хосте API остаётся на loopback; наружу его публикует Caddy.
Bootstrap сохраняет ключ администратора и отдельный клиентский ключ в защищённые
файлы `admin.json` и `client.json`. Клиент имеет роль `user`, общий account/user
`loginom-dock`, без извлечения персонального профиля. Повторный запуск не меняет
существующий ключ. При существующем пользователе и утраченном `client.json`
скрипт останавливается: восстановление или ротация выполняются явно.

Проверка сервера выполняет реальные HTTPS-запросы: readiness, identity клиента,
запрет административных операций, отказ без ключа и с неверным ключом,
инициализацию MCP и чтение каталога инструментов. Она не печатает credentials.
Проверки импорта и поиска выполняются отдельно; `/ready` не доказывает их качество.

### Закрытый GitLab и импорт

`deploy/loginom-dock/gitlab-tunnel.py` запускается на машине с VPN, с явно указанными
Dock `.env` и каталогом состояния. SSH использует пароль из этого файла и уже
проверенный `known_hosts`; пароль не передаётся в аргументах. Серверный каталог
`/opt/loginom-dock/tunnel` должен существовать с правами 0700. Туннель занимает только
Unix socket `gitlab.sock`, без публичного TCP-порта. После завершения импорта процесс
можно остановить. Перед повторным запуском удаляйте оставшийся socket только после
проверки, что старый процесс туннеля уже завершён.

Применяйте `compose.gitlab.yaml` третьим файлом после root и server Compose.
Он подключает закрытую сеть, Caddy gateway и LFS-адаптер. Сертификат внутренней CA
gateway добавляется к стандартному системному bundle в защищённом
`/opt/loginom-dock/config/ca-bundle.crt`; проверка TLS не отключается. В `ov.conf`
добавьте ровно `git.basegroup.ru` к `code_hosting_domains` и `gitlab_domains`,
сохранив стандартные значения, и включите `code.preserve_source_files: true`.
Задайте `code.source_only_extensions: [".lgp", ".lgd", ".svg", ".ai", ".sketch"]`:
эти файлы сохраняются как оригиналы, без текстовой индексации.

Рабочие catalog/manifest и их State находятся в `/opt/loginom-dock/assets`.
В копии каталога замените HTTP origin на внутренний HTTPS и задайте
`defaults.git.auth_ref: basegroup`. Сам секрет хранится в отдельном
`config/assets-credentials.json` (0600), только плоские поля `username`/`token`.
`config/ovcli.conf` (0600) указывает на публичный HTTPS Dock и ключ администратора
его аккаунта. Compose задаёт обе переменные путей CLI явно, без личного fallback.
Для неинтерактивного CLI также нужен `config/ovcli.settings.conf` с
`{"language":"en"}`. Upstream читает язык из `$HOME/.openviking` независимо от
пути `ovcli.conf`; Compose монтирует этот отдельный файл в каталог Dock внутри
контейнера. Системный locale не заменяет сохранённый выбор языка.

Скопируйте `deploy/loginom-dock/gitconfig` в `config/gitconfig` (0600).
Compose задаёт этот собственный файл Dock через `GIT_CONFIG_SYSTEM`; он включает
системные настройки образа, сохраняя LFS filters. Для трёх точных путей скачивания
LFS objects очищается `extraHeader`: GitLab уже выдаёт Authorization в download
action. Без этого Git LFS отправляет заголовок дважды, и GitLab отвергает запрос.
Авторизация Git и LFS batch остаётся штатной. Проверяйте именно `git lfs smudge`,
а не только отдельный HTTP-запрос: последний не воспроизводит дублирование.
В режиме `preserve_source_files` GitAccessor использует настоящий checkout
и выполняет штатный `git lfs pull --include= --exclude=` перед передачей parser.
Так загружаются и pointers, пропущенные smudge из-за неточных `.gitattributes`:
например, десять `.PNG` в справке при наличии правила только для `.png`.
Перед `pull` для оставшихся pointers из `git lfs ls-files --json` временно
дополняется `.git/info/attributes`; после операции прежнее содержимое восстанавливается.
История и оригинальный attributes не меняются; авторизация остаётся request-scoped.
Полнота подтверждается независимым аудитом.

```sh
docker exec loginom-dock-openviking-1 ov add-resource \
  --manifest /opt/loginom-dock/assets/sources.yaml --args dry_run:true --timeout 120
docker exec loginom-dock-openviking-1 ov add-resource \
  --manifest /opt/loginom-dock/assets/sources.yaml --wait --timeout 3600
```

Нельзя применять один manifest параллельно. После импорта `audit-sources.py`
сравнивает сохранённые оригиналы с независимым списком Git blob SHA-256 и LFS OID
выбранных commits. Скрипт скачивает каждый файл штатным API под обычным клиентским
ключом, проверяет размер и SHA-256. Отдельно проверяются поиск и чтение при
остановленном туннеле. Наличие бинарного fixture не засчитывается как семантический
разбор его содержимого; ссылки на внешние Git submodules фиксируются в манифесте.

`inventory-git-sources.py` создаёт baseline непосредственно из локальных Git objects
указанных commits и LFS pointers, без checkout или загрузки дополнительных копий.
Перед обновлением подготовьте baseline нужных ревизий. Серверный `import-sources.sh`
держит общую блокировку с backup, применяет Assets и обязательно запускает полный
аудит. Upstream синхронизация может записать ошибку отдельного перемещения в лог,
не прервав всю задачу, поэтому одного успешного статуса Assets для полноты
обновления недостаточно: при любом расхождении runner завершится с ошибкой.
Для адресного повтора допустим `sh import-sources.sh loginom-help` (также
`ai-skills` или `e2e-tests`). Он использует штатный отдельный manifest/State этого
источника с тем же `to` URI и затем проверяет весь набор. Основной manifest остаётся
полным; следующий общий импорт обновит его State через те же стабильные URI.

### Резервная копия

`sh deploy/loginom-dock/backup-server.sh` делает локальную холодную копию данных и
конфигов. Приложение кратко останавливается и запускается обратно даже при ошибке
архивации. Параллельный запуск защищён `flock`; существующая копия не перезаписывается.
В каталоге `/opt/loginom-dock/backups/<UTC timestamp>` сохраняются архивы,
SHA-256, image ID и путь исходного релиза. Файлы доступны только root: конфиги
содержат ключи. Копия на том же диске не защищает от потери VPS.
Если подготовлен каталог Assets, отдельный `assets.tar.gz` сохраняет его manifest,
catalog, State и результаты аудита, без временных логов и PID-файлов. Не запускайте
backup одновременно с импортом источников.

Для проверки восстановления создаётся **новый** Docker volume, туда распаковывается
`data.tar.gz`. `config.tar.gz` распаковывается в отдельный защищённый каталог;
его `ov.conf` монтируется только для чтения. Контейнер запускается из сохранённого
image ID в сети Dock без публикации портов. Проверяются прежний клиентский ключ,
чтение ресурса, поиск по восстановленному индексу и сохранённая сессия. Затем
проверочный контейнер останавливается, основной сервис продолжает работу.

Эта копия не содержит слоёв Docker, весов Ollama и ACME-хранилища Caddy: образы и
модель нужно сохранить отдельно для автономного аварийного восстановления, а
сертификат можно перевыпустить. Расписание, внешнее хранилище копий и полноценный
откат серверного/клиентского релиза остаются отдельной эксплуатационной приёмкой.

## Studio

```sh
cd web-studio
npm ci
npm run build -- --base=/studio/
NODE_OPTIONS=--no-experimental-webstorage npm test
```

Для локального просмотра сборки: `npm run preview -- --base=/studio/ --host 127.0.0.1 --port 4173`.
Без работающего сервера Studio показывает состояние отсутствия подключения;
это позволяет проверять оформление, но не доказывает работу API и поиска.

Исходник значка — `web-studio/public/loginom-dock.svg`. PNG/ICO в том же каталоге
используются браузером и PWA. Цвет значка соответствует существующей оранжевой теме.
В интерфейсе сохранена атрибуция OpenViking; ссылки SDK/API ведут в документацию
совместимой основы. Ссылка интеграций пока ведёт на честный статус реализации,
до выпуска проверенных пакетов Dock.

## Проверки

- `docker compose --env-file /dev/null config --quiet` проверяет конфигурацию без
  чтения локального `.env` и без запуска контейнеров.
- Проверки серверных изменений выполняются существующими suites в `tests/server/`.
- Live-проверки GitLab, MCP, моделей и Loginom отмечаются завершёнными только по
  наблюдаемому результату; сборка Studio не заменяет эти проверки.

При Node.js с экспериментальным Web Storage переменная `NODE_OPTIONS` выше
устраняет конфликт глобального `localStorage` с jsdom в тестовых worker-процессах.
Рабочий код и тесты из-за этой особенности окружения не изменялись.

Контейнер включает Git LFS и OpenSSH client. `git lfs install --system` включает
штатный smudge filter; фактическая hydration проверяется при импорте репозиториев.
