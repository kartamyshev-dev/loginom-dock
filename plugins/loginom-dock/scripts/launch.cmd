@echo off
setlocal
if defined LOGINOM_DOCK_HOME (
  set "dock_root=%LOGINOM_DOCK_HOME%"
) else (
  set "dock_root=%USERPROFILE%\.loginom-dock"
)
if not exist "%dock_root%\bin\loginom-dock.cmd" (
  echo Loginom Dock: сначала завершите мастер подключения и установку среды Dock. 1>&2
  exit /b 1
)
call "%dock_root%\bin\loginom-dock.cmd" %*
