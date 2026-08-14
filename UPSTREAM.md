# UPSTREAM

## Источник

- **Репозиторий:** https://github.com/haydenbleasel/blume
- **Тег:** `blume@1.4.1`
- **Коммит:** `058d1b29f51df2648ea2e2d21d4f865883eefe18`
- **Дата форка:** 9 августа 2026 года

## Настройка remotes

```text
origin    git@github.com:beandsmedia/bedocs.git
upstream  https://github.com/haydenbleasel/blume.git
```

## Регламент синхронизации

Для каждого нового релиза Blume:

1. Создать issue «Sync Blume X.Y.Z».
2. Проверить changelog, breaking changes, зависимости и лицензию.
3. Создать ветку `upstream-sync/x.y.z`.
4. Выполнить слияние или rebase согласно принятой стратегии репозитория.
5. Разрешить конфликты, не удаляя BeDocs-specific адаптеры.
6. Запустить полный CI, сборку документации и smoke-тест CLI.
7. Обновить этот файл и матрицу совместимости.
8. Открыть отдельный PR с перечнем перенесённых и отклонённых изменений.
9. Выпускать новую версию BeDocs только после ручной проверки русской локализации.

## Матрица совместимости

| BeDocs | Blume upstream | Примечания |
|--------|---------------|------------|
| 1.0.0  | 1.4.1          | Начальный форк |

## BeDocs-specific изменения

Следующие файлы и модули добавлены или существенно изменены относительно upstream и требуют особого внимания при merge:

- `packages/blume/src/core/product-meta.ts` — централизованные константы продукта
- `packages/blume/src/core/ui-packs/ru.ts` — русский UI-словарь (расширен)
- `packages/blume/src/cli/` — русские описания команд и сообщения
- `packages/blume/src/core/diagnostics.ts` — русские сообщения об ошибках
- `packages/blume/src/search/` — нормализация русского текста
- `admin/` — admin-панель для управления multi-project документацией (Express.js + static HTML/JS)
  - `admin/server.js` — API: CRUD проектов, upload-and-process, AI-генерация через crea-ai (RAG, поэтапный план, async job polling)
  - `admin/public/index.html` — UI: drag-and-drop загрузка, выбор файлов, прогресс AI-генерации
- `apps/docs/pages/index.astro` — динамическая главная страница со списком проектов
- `apps/docs/content/projects/` — multi-project структура контента
- `NOTICE.md`, `UPSTREAM.md`, `SECURITY.md`, `CONTRIBUTING.md` — BeDocs-specific файлы
- `scripts/check-branding.*`, `scripts/check-translations.*` — скрипты проверок
- Шаблоны Synthix, Taskcraft CRM, BeandsBooker
- Skills для AI-агентов на русском языке
