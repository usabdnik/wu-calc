# wu-calc

Проверки проекта: `node --test "tests/**/*.test.js"` из корня репозитория. E2E-тесты (`tests/e2e/`) открывают настоящие страницы в отдельном headless Google Chrome (`CHROME_BIN`, по умолчанию `google-chrome`); React и Babel страницы берут с unpkg — нужен интернет; запросы к `api.workoutudm.ru` в тестах заблокированы.
