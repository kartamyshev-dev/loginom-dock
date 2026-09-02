---
name: loginom
description: Выполняет задачи в Loginom через единое подключение Loginom Dock и отдельный локальный браузер.
---

Вызови `dock_prepare` из MCP `loginom-dock` перед первой работой в Loginom.
Основной skill приходит прямо в ответе; references читай из проверенного каталога
кэша. Используй tools этого же подключения и `dock_clipboard_transfer` для всех
последовательностей copy/paste. Оставь итоговый пакет открытым.

В Hermes с Tool Search сначала получи схему через `tool_describe`, затем передавай
все параметры внутрь `arguments`:
`tool_call({"name":"mcp__loginom_dock__browser_navigate","arguments":{"url":"адрес Loginom"}})`.
Параметры `url`, `key`, `code`, `function` не являются полями самого `tool_call`.
Для `browser_run_code_unsafe` значение `code` — функция `async (page) => { ... }`.
Имена полей сверяй с полученной схемой, путь кэша копируй точно из prepare.
При ошибке формата исправь аргументы. Не заменяй браузер Dock личным browser tool
или отдельным Browser Use: это меняет профиль и делает приёмку недействительной.

Личный `memory.provider` Hermes сохраняется. Архив Dock активируется отдельно
после успешной подготовки, начиная с вызвавшего её сообщения. Проверь состояние
через `dock_diagnostics`. При ошибке подключения используй мастер Dock выбранного
профиля Hermes; не переключайся на личные credentials OpenViking.
