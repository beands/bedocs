// Safe DOM helpers — build elements without innerHTML for user data.

// el("div", {class: "x", text: "t", onclick: fn, dataset: {...}, attrs: {...}}, [children])
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (key === "class") {
      node.className = value;
    } else if (key === "text") {
      node.textContent = value;
    } else if (key === "html") {
      node.innerHTML = value;
    } // only for trusted static markup
    else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else if (key === "attrs") {
      for (const [a, v] of Object.entries(value)) node.setAttribute(a, v);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else {
      node[key] = value;
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) {
      continue;
    }
    node.append(child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
  return node;
}
