# Contributing to BeDocs

Спасибо за интерес к BeDocs! Этот документ описывает процесс разработки и внесения изменений.

## Быстрый старт

```bash
git clone https://github.com/beandsmedia/bedocs.git
cd bedocs
bun install --frozen-lockfile
bun run check
bun run typecheck
bun run test
```

## Структура репозитория

- `packages/blume/` — ядро BeDocs (путь сохранён для совместимости с upstream)
- `apps/docs/` — официальная документация
- `skills/` — skills для AI-агентов
- `scripts/` — скрипты проверок брендинга и переводов

## Правила разработки

1. **Брендинг через `product-meta.ts`** — не размножайте строковые литералы `BeDocs`, `.bedocs`, `@beands/bedocs` по коду. Используйте централизованные константы.
2. **UI-строки через словари** — не хардкодьте тексты в компонентах. Добавляйте в `i18n-ui.ts` и переводите в `ui-packs/`.
3. **Минимум внутренних переименований** — не переименовывайте внутренние типы и функции только ради замены слова Blume. Это упрощает upstream merge.
4. **Тесты** — добавляйте или обновляйте тесты для каждой задачи.
5. **Changeset** — добавляйте changeset при изменении пользовательского поведения.
6. **Русский язык** — документация, CLI-сообщения и UI по умолчанию на русском.

## Процесс PR

1. Создайте ветку `feature/*` или `fix/*` от `main`.
2. Убедитесь, что `bun run check && bun run typecheck && bun run test` проходят.
3. Запустите `scripts/check-branding` и `scripts/check-translations`.
4. Опишите влияние на upstream sync в PR.
5. Минимум один review обязателен.

## Синхронизация с upstream

См. `UPSTREAM.md` для регламента синхронизации с Blume.
