.PHONY: game capture input agent monitor all run train play clean clean-all

all: game capture input agent monitor

game:
	cmd //c "cd /d game && build.cmd"

capture:
	cmd //c "cd /d capture && build.cmd"

input:
	cmd //c "cd /d input && build.cmd"

agent:
	cmd //c "cd /d agent && build.cmd"

monitor:
	cmd //c "cd /d monitor && build.cmd"

run:
	game\build\main.exe

train: game
	ai\run_train.bat

play: game
	ai\run_play.bat

clean:
	cmd //C "for /d %%d in (game capture input agent monitor) do @if exist %%d\build rmdir /S /Q %%d\build 2>NUL"
	cmd //C "del /Q /F ai\*.pkl 2>NUL & rmdir /S /Q ai\__pycache__ 2>NUL & rmdir /S /Q ai\logs 2>NUL"

clean-all: clean
	cmd //C "del /Q /F /S *.obj 2>NUL"
