interface Frame {
  indent: number;
  value: Record<string, unknown> | unknown[];
}

export function parseSimpleYaml(content: string): unknown {
  const root: Record<string, unknown> = {};
  const stack: Frame[] = [{ indent: -1, value: root }];
  const lines = content
    .replace(/\t/g, "  ")
    .split(/\r?\n/)
    .map((raw) => {
      const line = stripComment(raw);
      return {
        indent: line.match(/^ */)?.[0].length ?? 0,
        text: line.trim()
      };
    })
    .filter((line) => line.text);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const { indent, text } = lines[lineIndex];
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].value;
    const next = lines.find((line, index) => index > lineIndex && line.indent > indent);
    const childIsSequence = Boolean(next?.text.startsWith("- "));

    if (text.startsWith("- ")) {
      if (!Array.isArray(parent)) {
        throw new Error("YAML sequence item found outside a sequence");
      }
      const itemText = text.slice(2).trim();
      if (!itemText) {
        const item: Record<string, unknown> = {};
        parent.push(item);
        stack.push({ indent, value: item });
        continue;
      }
      const keyValue = splitKeyValue(itemText);
      if (keyValue) {
        const item: Record<string, unknown> = {};
        parent.push(item);
        assign(item, keyValue.key, keyValue.value, indent, stack, childIsSequence);
        stack.push({ indent, value: item });
      } else {
        parent.push(parseScalar(itemText));
      }
      continue;
    }

    if (Array.isArray(parent)) {
      throw new Error("YAML mapping entry found inside a sequence item");
    }
    const keyValue = splitKeyValue(text);
    if (!keyValue) {
      throw new Error(`Invalid YAML line: ${text}`);
    }
    assign(parent, keyValue.key, keyValue.value, indent, stack, childIsSequence);
  }

  return root;
}

function assign(
  target: Record<string, unknown>,
  key: string,
  value: string,
  indent: number,
  stack: Frame[],
  childIsSequence: boolean
): void {
  if (!key) throw new Error("YAML keys cannot be empty");
  if (value === "") {
    const container: Record<string, unknown> | unknown[] = childIsSequence ? [] : {};
    target[key] = container;
    stack.push({ indent, value: container });
    return;
  }
  target[key] = parseScalar(value);
}

function splitKeyValue(text: string): { key: string; value: string } | undefined {
  const index = text.indexOf(":");
  if (index < 0) return undefined;
  return {
    key: text.slice(0, index).trim(),
    value: text.slice(index + 1).trim()
  };
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  return quoted ? quoted[2] : trimmed;
}

function stripComment(line: string): string {
  let quoted: string | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "'" || char === '"') && line[index - 1] !== "\\") {
      quoted = quoted === char ? undefined : quoted ?? char;
    }
    if (char === "#" && !quoted && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index);
    }
  }
  return line;
}
