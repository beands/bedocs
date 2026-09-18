// Prompt builders and response parsers for AI generation.
// Logic preserved from the original server.js implementation.

export function buildAnalyzePrompt(projectName, files, instructions) {
  const fileList = Object.keys(files)
    .map((name) => `- ${name} (${files[name].length} симв.)`)
    .join("\n");
  // RAG: send full content of all files (truncated to 3000 chars each to fit context)
  const fullContent = Object.entries(files)
    .map(([name, content]) => {
      const truncated =
        content.length > 3000
          ? `${content.slice(0, 3000)}\n... [обрезано]`
          : content;
      return `### Файл: ${name}\n\n${truncated}`;
    })
    .join("\n\n---\n\n");
  return `Проект: ${projectName}\n\nСписок файлов:\n${fileList}\n\nПолное содержимое файлов:\n${fullContent}\n\nИнструкции: ${instructions || "Создать полноценную структурированную документацию проекта"}\n\nПроанализируй ВСЕ файлы и создай ПЛАН документации в следующем формате:\n\nДля каждой страницы укажи:\n- **Имя файла:** filename.mdx\n- **Заголовок:** Русский заголовок страницы\n- **Источники:** какие исходные файлы использовать\n- **Описание:** краткое содержание (1-2 предложения)\n- **Порядок:** число для sidebar order\n- **Связи:** на какие другие страницы ссылается\n\nСоздай от 5 до 15 страниц. Объедини связанные файлы в одну страницу где уместно. Создай страницу index.mdx как главную страницу проекта.\n\nНачни план со строки "ПЛАН:" и затем перечисли каждую страницу.`;
}

export function parsePlanPages(analysis, availableFiles) {
  const pages = [];
  // Try to parse structured plan from AI response
  const planMatch = analysis.match(/ПЛАН:([\s\S]*?)$/i);
  const planText = planMatch ? planMatch[1] : analysis;

  // Match patterns like "**Имя файла:** xxx.mdx" followed by other fields
  const pageRegex =
    /\*\*Имя файла:\*\*\s*(\S+\.mdx?)[\s\S]*?(?=\*\*Имя файла:\*\*|$)/gi;
  let match;
  while ((match = pageRegex.exec(planText)) !== null) {
    const block = match[0];
    const fileName = match[1];
    const titleMatch = block.match(/\*\*Заголовок:\*\*\s*(.+)/i);
    const sourcesMatch = block.match(/\*\*Источники:\*\*\s*(.+)/i);
    const descMatch = block.match(/\*\*Описание:\*\*\s*(.+)/i);
    const orderMatch = block.match(/\*\*Порядок:\*\*\s*(\d+)/i);

    const title = titleMatch
      ? titleMatch[1].trim()
      : fileName.replace(/\.mdx?$/, "").replaceAll(/[-_]/g, " ");
    const sourcesRaw = sourcesMatch ? sourcesMatch[1].trim() : "";
    const sources = sourcesRaw
      .split(/[,;]\s*/)
      .map((s) => s.trim().replaceAll(/^["']|["']$/g, ""))
      .filter(
        (s) =>
          availableFiles.includes(s) ||
          availableFiles.some((f) => f.includes(s))
      );
    const description = descMatch ? descMatch[1].trim() : "";
    const order = orderMatch ? Number.parseInt(orderMatch[1]) : pages.length;

    pages.push({ description, fileName, order, sources, title });
  }

  // Sort by order
  pages.sort((a, b) => a.order - b.order);
  return pages;
}

export function buildPagePrompt(
  projectName,
  page,
  sourceContents,
  allPages,
  instructions,
  analysis
) {
  const sourceList = Object.keys(sourceContents)
    .map((name) => `- ${name}`)
    .join("\n");
  const fullSources = Object.entries(sourceContents)
    .map(([name, content]) => {
      const truncated =
        content.length > 6000
          ? `${content.slice(0, 6000)}\n... [обрезано]`
          : content;
      return `### Файл: ${name}\n\n${truncated}`;
    })
    .join("\n\n---\n\n");

  const otherPages = allPages
    .filter((p) => p.fileName !== page.fileName)
    .map((p) => `- ${p.fileName}: ${p.title}`)
    .join("\n");

  return `Проект: ${projectName}\n\nПлан документации:\n${analysis.slice(0, 2000)}\n\n---\n\nСоздаётся страница:\n- **Имя файла:** ${page.fileName}\n- **Заголовок:** ${page.title}\n- **Описание:** ${page.description}\n\nИсходные файлы для этой страницы:\n${sourceList}\n\nПолное содержимое исходных файлов:\n${fullSources}\n\nДругие страницы документации (для ссылок):\n${otherPages}\n\nИнструкции: ${instructions || "Создай качественную структурированную документацию"}\n\nЗадача:\n1. Создай MDX файл с frontmatter: title, description, sidebar (label, order ${page.order})\n2. Используй компоненты BeDocs: <Card>, <CardGroup>, <Steps>, <Step>, :::tip, :::note\n3. Пиши на русском языке\n4. Сохраняй ВСЮ техническую информацию: примеры кода, API, конфигурации\n5. Не выдумывай факты — только данные из исходных файлов\n6. Добавляй ссылки на другие страницы: [Текст](/projects/${projectName}/page-name)\n7. Структурируй контент с заголовками ##, ###\n\nВерни результат в формате:\n\`\`\`file:${page.fileName}\n---\ntitle: "${page.title}"\ndescription: "${page.description}"\nsidebar:\n  label: "${page.title}"\n  order: ${page.order}\n---\n\n[содержимое страницы]\n\`\`\``;
}

// Continuation prompt used when a stream broke mid-page. The model gets the
// tail of the saved draft and must continue without repeating it.
export function buildContinuationPrompt(page, draftTail) {
  return `Страница "${page.fileName}" (${page.title}) генерировалась, но поток оборвался.

Вот УЖЕ сгенерированная часть (хвост черновика):

\`\`\`mdx
${draftTail}
\`\`\`

Продолжи текст СТРОГО с места обрыва:
- НЕ повторяй уже написанное ни словом — продолжай со следующего предложения/строки;
- НЕ добавляй преамбулу, комментарии или пояснения;
- продолжай в том же формате MDX (frontmatter НЕ повторяй, если он уже был выведен);
- выводи только продолжение содержимого страницы.`;
}

export function parseGeneratedFiles(text) {
  const files = {};
  const regex = /```file:(\S+\.mdx?)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    files[match[1]] = match[2].trim();
  }
  if (Object.keys(files).length === 0) {
    const altRegex = /```(\S+\.mdx?)\n([\s\S]*?)```/g;
    while ((match = altRegex.exec(text)) !== null) {
      if (match[1].endsWith(".md") || match[1].endsWith(".mdx")) {
        files[match[1]] = match[2].trim();
      }
    }
  }
  return files;
}
