import type { IMessageElement } from 'client-types/';

const toSafeLinkTarget = (name: string) =>
  encodeURIComponent(name.replace(/\s+/g, '_'))
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29'); // Encode parentheses to avoid issues in URLs

const isForIdMatch = (id: string | number | undefined, forId: string) => {
  if (!forId || !id) {
    return false;
  }

  return forId === id.toString();
};

const escapeRegExp = (string: string) => {
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#escaping
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Line-start ``` / ~~~ fences, also behind `>` prefixes; unclosed fences run to the end.
const BLOCKQUOTE_PREFIX_RE = /^((?: {0,3}>[ \t]?)*)( {0,3})(`{3,}|~{3,})(.*)$/;
const splitFenceAwareLines = (text: string) => {
  let fenceChar = '';
  let fencePrefix = '';
  let closeRe: RegExp | null = null;
  const parts = text.split(/(\r\n|\n)/);
  const out: { line: string; sep: string; code: boolean }[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i];
    // Closes when the blockquote prefix isn't continued.
    if (fenceChar && fencePrefix && !line.startsWith(fencePrefix)) {
      fenceChar = '';
      closeRe = null;
    }
    let code = !!fenceChar;
    if (fenceChar) {
      if (
        line.startsWith(fencePrefix) &&
        closeRe!.test(line.slice(fencePrefix.length))
      ) {
        fenceChar = '';
        closeRe = null;
      }
    } else {
      const m = BLOCKQUOTE_PREFIX_RE.exec(line);
      if (m && !(m[3][0] === '`' && m[4].includes('`'))) {
        fencePrefix = m[1];
        fenceChar = m[3][0];
        closeRe = new RegExp(`^ {0,3}\\${fenceChar}{${m[3].length},} *$`);
        code = true;
      }
    }
    out.push({ line, sep: parts[i + 1] || '', code });
  }
  return out;
};

// Hand-rolled scan instead of lookbehind regex: unsupported on Safari < 16.4.
const splitInlineCode = (line: string) => {
  const segments: { text: string; code: boolean }[] = [];
  let start = 0;
  let i = 0;
  while (i < line.length) {
    if (line[i] === '`' && line[i - 1] !== '\\') {
      let j = i;
      while (line[j] === '`') j++;
      const openLen = j - i;
      let k = j;
      let close = -1;
      while (k < line.length) {
        if (line[k] !== '`') {
          k++;
          continue;
        }
        let m = k;
        while (line[m] === '`') m++;
        if (m - k === openLen) {
          close = m;
          break;
        }
        k = m;
      }
      if (close !== -1) {
        if (start < i)
          segments.push({ text: line.slice(start, i), code: false });
        segments.push({ text: line.slice(i, close), code: true });
        i = start = close;
        continue;
      }
      i = j;
      continue;
    }
    i++;
  }
  if (start < line.length)
    segments.push({ text: line.slice(start), code: false });
  return segments;
};

export const prepareContent = ({
  elements,
  content,
  id,
  language
}: {
  elements: IMessageElement[];
  content?: string;
  id: string;
  language?: string;
}) => {
  const elementNames = elements.map((e) => escapeRegExp(e.name));

  // Sort by descending length to avoid matching substrings
  elementNames.sort((a, b) => b.length - a.length);

  const elementRegexp = elementNames.length
    ? new RegExp(`(${elementNames.join('|')})`, 'g')
    : undefined;

  let preparedContent = content ? content.trim() : '';
  const inlinedElements = elements.filter(
    (e) => isForIdMatch(id, e?.forId) && e.display === 'inline'
  );
  const refElements: IMessageElement[] = [];

  const linkNames = (text: string) =>
    text.replaceAll(elementRegexp!, (match) => {
      const element = elements.find((e) => {
        const nameMatch = e.name === match;
        const scopeMatch = isForIdMatch(id, e?.forId);
        return nameMatch && scopeMatch;
      });
      const foundElement = !!element;

      const inlined = element?.display === 'inline';
      if (!foundElement) {
        // Element reference does not exist, return plain text
        return match;
      } else if (inlined) {
        // If element is inlined, add it to the list and return plain text
        if (inlinedElements.indexOf(element) === -1) {
          inlinedElements.push(element);
        }
        return match;
      } else {
        // Element is a reference, add it to the list and return link
        refElements.push(element);
        // Build a Markdown-safe link: escape text, and encode () in the slug
        // The address in the link is not used anyway
        return `[${match}](${toSafeLinkTarget(match)})`;
      }
    });

  // A `language` wrap below turns the whole content into a code block, so skip linking then.
  if (elementRegexp && preparedContent && !language) {
    preparedContent = splitFenceAwareLines(preparedContent)
      .map(({ line, sep, code }) => {
        const linked = code
          ? line
          : splitInlineCode(line)
              .map((s) => (s.code ? s.text : linkNames(s.text)))
              .join('');
        return linked + sep;
      })
      .join('');
  }

  if (language && preparedContent) {
    const prefix = `\`\`\`${language}`;
    const suffix = '```';
    if (!preparedContent.startsWith('```')) {
      preparedContent = `${prefix}\n${preparedContent}\n${suffix}`;
    }
  }
  return {
    preparedContent,
    inlinedElements,
    refElements
  };
};
