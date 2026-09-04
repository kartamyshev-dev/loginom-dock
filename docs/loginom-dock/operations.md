# Сервер, конфигурация и развёртывание

Сначала прочитать [памятку агенту](agent-handoff.md). Инвентаризация ниже сверена
с сервером 4 сентября 2026 года; перед изменениями повторить read-only проверки.
Секреты здесь намеренно не приводятся. Документационная задача не является
поводом перезапускать сервисы, переустанавливать клиента или запускать модели.

## Доступ и расположение

VPS Dock — **82.22.23.10**, Ubuntu 24.04, Docker/Compose уже установлены.
Публичные порты — 80/443, SSH — из конфигурации проекта. API на хосте слушает
`127.0.0.1:1933`; Ollama доступна внутри Docker-сети. DNS обоих доменов указывает
на этот VPS. Сертификатами управляет Caddy.

На машине разработки checkout находится в `/Users/kartamyshev/Git/loginom-dock`.
Локальный `.env` содержит `LOGINOM_DOCK_SSH_HOST`, `LOGINOM_DOCK_SSH_PORT`,
`LOGINOM_DOCK_SSH_USER`, `LOGINOM_DOCK_SSH_PASSWORD`, `LOGINOM_DOCK_DOMAIN`,
`LOGINOM_TARGET_URL` и `OPENROUTER_API_KEY`. Проверенный SSH host key хранится в
`.dock/known_hosts`. Содержимое `.env` не исполнять через `source` и не печатать.

Для неинтерактивного SSH уже используется `sshpass -e`: пароль передаётся только
через окружение дочернего процесса. Пример **read-only** проверки из корня checkout:

```python
import os, pathlib, shlex, subprocess

root = pathlib.Path.cwd()
config = {}
for line in (root / '.env').read_text().splitlines():
    if '=' not in line or line.lstrip().startswith('#'):
        continue
    key, value = line.split('=', 1)
    words = shlex.split(value, comments=True)
    config[key.strip()] = words[0] if words else ''
env = dict(os.environ, SSHPASS=config['LOGINOM_DOCK_SSH_PASSWORD'])
ssh = ['sshpass', '-e', 'ssh', '-p', config.get('LOGINOM_DOCK_SSH_PORT', '22'),
       '-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no',
       '-o', 'StrictHostKeyChecking=yes',
       '-o', f'UserKnownHostsFile={root / ".dock/known_hosts"}',
       '-o', 'ConnectTimeout=30',
       f'{config["LOGINOM_DOCK_SSH_USER"]}@{config["LOGINOM_DOCK_SSH_HOST"]}']
subprocess.run(ssh + ['python3 /opt/loginom-dock/tools/verify-server.py'],
               env=env, check=True)
```

При отсутствии `.env`, `known_hosts` или сетевого доступа остановить только
зависящие от них операции и сообщить, чего не хватает. Не заменять SSH-аутентификацию
или проверку host key. Временные `/private/tmp/loginom-dock-*.py/.sh` использовались
в прежних задачах, но не входят в репозиторий и не являются обязательным инструментом.
Для нового сценария можно передавать проверенный shell-файл в `ssh ... bash -s`
через stdin; пароль и текст конфигов не должны попадать в команды или вывод.

### Пути на VPS

Все следующие пути относятся к `/opt/loginom-dock`, если не указано иначе.

| Путь | Назначение |
| --- | --- |
| `current` | Symlink на проверенный текущий серверный релиз |
| `releases/<id>/src/` | Снимок исходников для конкретной сборки |
| `releases/<id>/source.tar.gz`, `source.commit` | Архив исходников и полный commit; архив требуется backup-скрипту |
| `releases/<id>/image.name`, `image.id` | Образ приложения и проверенный Docker image ID |
| `releases/<id>/caddy-image.name`, `caddy-image.id` | Образ Caddy с лендингом и его ID |
| `releases/<id>/previous-release`, `deploy.env.before` | Предыдущий релиз и защищённая конфигурация для отката, если подготовлены при развёртывании |
| `prepared-release` | Кандидат для сборки; не доказывает, что этот релиз работает |
| `config/deploy.env` | Переменные production Compose: образы, ревизия, основной домен и публичный origin |
| `config/ov.conf` | Активные модели, auth и workspace сервера; mount в `/app/.openviking/ov.conf` |
| `config/client.json` | Обычный клиентский ключ общего аккаунта |
| `config/admin.json` | Ключ администратора аккаунта Dock для ресурсов/skill; отличается от server root key |
| `config/ovcli.conf`, `ovcli.settings.conf` | Собственные endpoint/ключ и язык CLI внутри контейнера |
| `config/assets-credentials.json` | Credentials GitLab для штатного Assets importer |
| `config/ca-bundle.crt`, `gitconfig`, `Caddyfile.gitlab` | Доверие внутреннему HTTPS gateway и настройки Git/LFS |
| `assets/` | Рабочие catalog, manifests, Assets State, baseline/audit, skill ZIP и memory templates |
| `tools/` | Установленные эксплуатационные скрипты из `deploy/loginom-dock/`; checkout сам их не обновляет |
| `deploy-stage2/compose.gitlab.yaml`, `gitlab-lfs-proxy.py` | Действующее дополнение Compose и код LFS proxy |
| `tunnel/gitlab.sock` | Unix socket временного reverse SSH-туннеля с машины под VPN |
| `client-build/` | Серверные входные файлы, клиентские комплекты и извлечённые предпросмотры |
| `backups/`, `latest-backup` | Полные локальные копии, архивы образов и указатель последней успешной копии |
| `monitoring/health.json` | Последний ограниченный отчёт состояния без provider messages/credentials |

Credentials имеют права 0600, их каталоги — 0700. Оригинальные данные находятся
в Docker volume `loginom-dock_dock_data`, внутри приложения —
`/app/.openviking/workspace`. Не редактировать внутренние индексы напрямую.
Остальные тома: `loginom-dock_caddy_data`, `loginom-dock_caddy_config`,
`loginom-dock_ollama_data`, `loginom-dock_gitlab_tls`.

### Снимок работающей установки

Текущий релиз — `/opt/loginom-dock/releases/20260904-landing-8db5ae82`, исходный
commit `8db5ae82d1cf3c4fd9434303d7caea1349e4225b`.
SHA-256 `source.tar.gz`:
`a60d2d0c4676418f432e412cab600251e05d578941de1e427336b3b3a206bcd3`.
Следующие коммиты документации в GitHub не требуют смены серверной ревизии.

| Контейнер | Работающий образ |
| --- | --- |
| `loginom-dock-openviking-1` | `loginom-dock:studio-landing-70411dfe` |
| `loginom-dock-caddy-1` | `loginom-dock:landing-8db5ae82` |
| `loginom-dock-ollama-1` | `ollama/ollama@sha256:020e4134285e2ef4d8fd801234176de3b4faadc992a3eb06c8e66a2f9d4c4ba2` |
| `loginom-dock-gitlab-gateway-1` | `caddy@sha256:df7f1c2fb114453b951de51a98efc010db1655a92c2e86be6706714e2417a78d` |
| `loginom-dock-gitlab-lfs-proxy-1` | `loginom-dock:stage2-b2975a94` |

Image ID приложения:
`sha256:291a9afdde3696ef84cb5ea674c93f5c09bfa4268cd59978cca7cf7d52ff6066`.
Image ID Caddy/лендинга:
`sha256:593a17b3542ea10800427bd382b969a351066e85cd4342481951b3a97aec387d`.
Приложение и Studio не пересобирались при обновлении `0.1.0-rc.2`: они сохранены
на прежнем проверенном образе `loginom-dock:studio-landing-70411dfe`. Другие два
вспомогательных контейнера также сохранены на прежних проверенных образах.
Общий `compose up` может пересоздать их из новых значений переменных образов;
при адресном обновлении указывать нужные сервисы и `--no-deps`.

### Модели

Канонические **активные** значения находятся в `config/ov.conf`. Локальный
`OPENROUTER_API_KEY` — копия ключа для работы с проектом; изменение одного `.env`
само по себе не обновляет работающий сервер.

| Функция | Модель в проверенном конфиге | Провайдер |
| --- | --- | --- |
| Embedding | `voyageai/voyage-4` | OpenRouter, адаптер `openai` |
| VLM | `qwen/qwen3.7-flash` | OpenRouter, адаптер `openai` |
| Rerank | `voyageai/rerank-2.5-lite` | OpenRouter, адаптер `openai` |
| Query planner | `ollama/guoxuter/ov_intent_analysis_sft:v7_q8` | Локальная Ollama через `litellm` |

При обновлении этой документации проверены настройки и readiness, **новые запросы
к моделям не выполнялись**. Результаты прежних реальных проверок — в журнале.
Применять ограничения моделей и исключение Hermes/ChatGPT из `AGENTS.md`.
После атомарной замены `ov.conf` нужно пересоздать приложение: простой `restart`
может оставить bind mount старого inode. Не менять upstream default account/user;
общий аккаунт клиентов выбирается ключом.

## Команды первичной проверки

Команды ниже выполняются **на VPS**. Они не выводят полные секретные конфиги.

```sh
readlink -f /opt/loginom-dock/current
cat /opt/loginom-dock/current/source.commit
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
docker inspect loginom-dock-caddy-1 --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
python3 /opt/loginom-dock/tools/verify-server.py
systemctl list-timers --all --no-pager 'loginom-dock-*'
cat /opt/loginom-dock/monitoring/health.json
```

Не печатать полный `docker inspect`/`docker compose config`, `ov.conf`, `.env`,
`client.json` или истории агента: они могут содержать секреты. Для синтаксиса
Compose использовать `config --quiet`. `verify-server.py` проверяет HTTPS,
readiness, аутентификацию, права обычного клиента и каталог MCP; это не тест модели
или полного сценария Loginom.

### Точный production Compose

Выполнять из `src/` выбранного релиза. При проверке текущего стека:

```sh
cd /opt/loginom-dock/current/src
dock_compose() {
  docker compose --env-file /opt/loginom-dock/config/deploy.env \
    -f docker-compose.yml -f deploy/loginom-dock/compose.server.yaml \
    -f /opt/loginom-dock/deploy-stage2/compose.gitlab.yaml \
    --profile server "$@"
}
dock_compose config --quiet
dock_compose ps
```

Третий файл обязателен для существующего production: в нём mounts CLI/Assets,
GitLab CA и закрытая сеть. Не заменять его шаблоном из нового checkout вслепую.
При смене каталога релиза относительный путь Caddyfile тоже меняется; проверить
фактический mount. Не запускать `down -v`, не очищать Docker images/volumes как
часть обычного обновления.

## Подготовка и публикация изменения

### 1. Выбрать сборку

| Что изменено | Сборка на VPS | Что пересоздать после проверки |
| --- | --- | --- |
| Только документация | Не нужна | Ничего |
| Статика лендинга / Caddyfile | `Dockerfile.landing` | `caddy` |
| Только Studio | `Dockerfile.studio-update`, `BASE_IMAGE` из проверенного текущего приложения | `openviking` |
| Backend, Python/Rust/C++, серверные зависимости | Корневой `Dockerfile` | `openviking` и только действительно затронутые вспомогательные сервисы |
| Клиент/native plugins | [Выпуск клиентских комплектов](releasing.md) | Серверный образ сам по себе не обновляет клиент пользователя |
| Полный skill | Проверенный ZIP, `publish-skill.py`, manifest/read-back | Новая клиентская сессия; не пересборка сервера |

`Dockerfile.studio-update` заменяет **только** assets Studio в установленном
Python-пакете; он не переносит изменения backend. Исторические `Dockerfile.*-update`
также имеют узкий набор файлов и не являются универсальной сборкой.

### 2. Подготовить независимый каталог релиза

Зафиксировать проверенные исходники, убедиться в чистоте Git. Для полного снимка
можно использовать стандартный Git archive; временный старый упаковщик не требуется:

```sh
dock_revision=$(git rev-parse HEAD)
mkdir -p .dock
git archive --format=tar "$dock_revision" | gzip -n > ".dock/server-$dock_revision.tar.gz"
shasum -a 256 ".dock/server-$dock_revision.tar.gz"
```

Перед передачей проверить состав архива: только исходники, без credentials,
локальных зависимостей, профилей, `.dock` и build artifacts. Передать через SSH
в новый каталог `/opt/loginom-dock/releases/<уникальный-id>/source.tar.gz`;
проверить SHA-256 на VPS и распаковать в `src/`. Сохранить полный `source.commit`.
Не распаковывать поверх `current`. Наличие архива требуется последующим backup.

На VPS из нового `src/`, с явно заданными непустыми переменными:

```sh
# dock_revision — полный commit; dock_caddy_image/dock_app_image — новые уникальные теги.
docker build -f deploy/loginom-dock/Dockerfile.landing \
  --build-arg LOGINOM_DOCK_REVISION="$dock_revision" -t "$dock_caddy_image" .

# Только при изменениях Studio; dock_base_image — проверенный текущий образ приложения.
docker build -f deploy/loginom-dock/Dockerfile.studio-update \
  --build-arg BASE_IMAGE="$dock_base_image" \
  --build-arg LOGINOM_DOCK_REVISION="$dock_revision" -t "$dock_app_image" .
```

Для полной серверной сборки вместо overlay использовать корневой Dockerfile с
`OPENVIKING_VERSION=0.1.0.dev0`, `UV_LOCK_STRATEGY=locked`,
`LOGINOM_DOCK_REVISION` и новым уникальным тегом. Не перезаписывать текущий тег.
Проверить image ID и сохранить `image.name/image.id`, `caddy-image.name/caddy-image.id`.
Если компонент не пересобирался, записать его фактический сохранённый образ.

### 3. Проверить до переключения

Для Caddy из нового `src/`:

```sh
docker run --rm --env LOGINOM_DOCK_DOMAIN=loginom.duckdns.org \
  -v "$PWD/deploy/loginom-dock/Caddyfile.server:/etc/caddy/Caddyfile:ro" \
  "$dock_caddy_image" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Дополнительно проверить HTTP-ответы в отдельном временном контейнере на loopback
с тестовой копией Caddyfile и явно HTTP listener. Syntax validation не проверяет
итоговые заголовки. Для лендинга страницы/JS/CSS имеют `Cache-Control: no-cache`,
WOFF2 — `public, max-age=31536000, immutable`; соответствующие matchers не пересекаются.
Именно конфликт этих правил вызвал откат первой публикации лендинга.

Извлечь собранные файлы через `docker cp` для предпросмотра либо проверить кандидат
на сервере. Пройти четыре выбора агент/ОС, ссылки, копирование, примеры, FAQ,
широкий и узкий экран. Сайт не требует моделей. Контейнер проверки убрать после
завершения; production volumes к нему не подключать.

### 4. Переключить только нужные сервисы и проверить

До изменения `config/deploy.env` сохранить его защищённую копию в новом релизе и
путь прежнего `current`. Не перезаписывать исходную копию при повторе неудачного
развёртывания. Менять только нужные переменные образов и ревизию, сохраняя остальное.
`LOGINOM_DOCK_DOMAIN` остаётся `loginom.duckdns.org`; домен лендинга задан отдельно
в `Caddyfile.server`.

Из нового `src/` использовать функцию `dock_compose` выше, например:

```sh
# При обновлении и Studio, и лендинга; для одного компонента оставить только его имя.
dock_compose up -d --no-build --no-deps --force-recreate openviking caddy
python3 /opt/loginom-dock/tools/verify-server.py
```

Дождаться healthy/readiness и сертификата, проверить публичный лендинг, MCP старого
домена, 302 для обеих форм `/studio/connect`, переход внутри Studio, корректные
MIME-типы и 404 на `/mcp` нового домена. При backend-изменении добавить проверки
затронутого поведения. Только после успеха переключить `current` на новый релиз
и записать фактические образы/хеши/результаты в документацию.

При ошибке вернуть сохранённый `deploy.env`, выполнить Compose из **предыдущего**
`src/` и пересоздать те же затронутые сервисы. Вернуть `current`, если он уже менялся,
затем повторить проверку готовности. Для Caddy откатываются и образ, и Caddyfile.
Данные и серверные credentials при таком откате не восстанавливаются из старой копии.
Автоматический откат образа допустим только при совместимом формате данных;
для миграций хранилища нужен отдельный порядок восстановления.

## Источники и skill

Канонические URI трёх источников перечислены в [архитектуре](architecture.md).
В рабочем `assets/catalog.yaml` используются внутренний HTTPS origin и `auth_ref`;
репозиторный catalog сохраняет исходные locator. Не публиковать рабочие credentials
вместе с catalog. `.source/` хранит оригиналы, `.source-manifest.json` — контрольные
суммы; обычное поддерево используется для семантического поиска.

Для обновления нужен временный туннель с машины под VPN:

```sh
python3 deploy/loginom-dock/gitlab-tunnel.py --env-file .env --state-dir .dock
```

Он работает на переднем плане. Предварительно проверить host key, права и отсутствие
другого владельца socket. Импорт запускать установленным `tools/import-sources.sh`:
он сериализуется с backup и завершает работу полным аудитом. До запуска подготовить
baseline нужных ревизий. Порядок и адресный повтор — в [development.md](development.md).
Чтение уже импортированных данных не требует запуска туннеля или повторного импорта.

Полный skill публикуется из проверенного ZIP через `tools/publish-skill.py` с
явными `--archive`, `--admin`, `--report`. Сначала читать текущий manifest, затем
проверять результат и целостность. Отчёт — `assets/skill-publication.json`.
Не менять закреплённый skill текущей сессии. Полная процедура относится к изменению
skill, а не к каждой задаче через Dock.

## Клиент на машине пользователя

| Путь | Назначение |
| --- | --- |
| `~/.loginom-dock/config.json` | Активные endpoint, обычный клиентский ключ, Loginom URL; 0600 |
| `~/.loginom-dock/bin/` | Launchers, которые разрешают текущую установленную среду |
| `~/.loginom-dock/releases/`, `current`, `previous` | Проверенные среды, активная и предыдущая версии; на Windows `current`/`previous` — pointer-файлы |
| `~/.loginom-dock/current/runtime/node` | Закреплённый Node; на Windows путь разрешается через pointer и оканчивается `runtime\\node.exe` |
| `~/.loginom-dock/runtime/browsers/` | Управляемый Chromium |
| `~/.loginom-dock/sessions/<id>/session.json` | Реальные pins, пути, признак archive activation |
| `~/.loginom-dock/sessions/<id>/browser-profile/`, `artifacts/` | Изолированный браузер и результаты этой сессии |
| `~/.loginom-dock/archive/queue.sqlite` | Durable очередь, WAL/FULL; не очищать для устранения ошибки доставки |
| `~/.loginom-dock/registration-*` | Журнал native-регистрации и восстановления; может содержать credentials |
| `<checkout>/.dock/` | Приватные отчёты разработки, проверки и скачанные серверные артефакты |

На 4 сентября текущая установленная среда macOS этой машины —
`~/.loginom-dock/releases/0.1.0-dev.0-038fefe35353`. Не обновлять её молча ради
совпадения номеров версий. При диагностике смотреть `session.json` конкретной задачи.
Hermes должен использовать существующий выбранный профиль (`HERMES_HOME` или
явный `--hermes-home`) и уже подключённую подписку ChatGPT; личный memory provider
не менять. Полные transcript/config не выводить для поиска версии или имени профиля.

Релизные доказательства — `.dock/releases/v0.1.0-rc.2/`; Windows-результат и
скриншот — в его подкаталоге `evidence/`. Предыдущая приёмка Hermes —
`.dock/native-hermes-chatgpt-result.json` и `.dock/hermes-chatgpt-archive-verification.json`,
лендинг — `.dock/landing-preview/`. Эти файлы не входят в Git; новый checkout может
их не иметь. Подтверждённые выводы и хеши сохраняются в журнале.

### Windows-машина для live-проверок

Проверенная машина — `192.168.1.48`, Windows 11 x64, пользователь `POWERUP\\vskar`.
OpenSSH доступен из локальной сети по отдельному ключу разработки; этот доступ
явно разрешён пользователем. Не публиковать приватный ключ и не заменять настройки
доступа без отдельной задачи. На машине установлены Codex и Hermes 0.21.0. Для
создания сценариев Hermes использует существующую подписку ChatGPT, provider
`openai-codex` и модель `gpt-5.6-sol`; не переключать его на OpenRouter или другую
модель ради тестов.

У Windows-машины нет постоянного VPN к целевому Loginom. Приёмка `0.1.0-rc.2`
использовала временный reverse SSH-мост через машину разработки для HTTP и
WebSocket; запись hosts, туннели и временная задача планировщика после проверки
удалены. Для новой live-проверки сначала организовать штатный VPN либо заново
создать явный временный мост к обоим протоколам. Доступность только HTTP не
подтверждает работу Loginom: без WebSocket интерфейс не завершает подключение.

## Резервирование и мониторинг

`loginom-dock-monitor.timer` и `loginom-dock-backup.timer` включены и активны.
Первый запускается каждые пять минут; второй — в 05:00 **Europe/Moscow**, независимо
от часового пояса, которым `systemctl list-timers` отображает даты.

`tools/backup-server.sh` сохраняет пять томов, образы всех пяти контейнеров,
config, assets, source archive и эксплуатационные файлы. Он кратко останавливает
сервисы, сериализуется с импортом и возобновляет их при ошибке. Для переноса нужны
каталог копии и все файлы `backups/images`, на которые ссылается `image-checksums`.
Копии содержат credentials; права и закрытое хранение обязательны.

На момент проверки `latest-backup` указывает на `backups/20260903T020016Z`.
Восстановление выполняется `tools/restore-server.py --backup ... --name ... --root ...`
в отдельные сеть, тома и контейнеры; порты по умолчанию 19433/19443 только на loopback.
Проверить свободные порты, место и контрольные суммы до запуска. Оно не переключает
production DNS или публичные порты. Подробности — в [deploy README](../../deploy/loginom-dock/README.md).

Лендинг уже входит в Caddy image и существующий backup. Не считать `healthy` в
мониторинге проверкой всех сценариев, всех моделей или пригодности последней копии
к восстановлению без отдельной проверки.
