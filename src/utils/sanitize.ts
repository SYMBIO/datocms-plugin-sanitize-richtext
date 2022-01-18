import sanitizeHtml from 'sanitize-html';

export default function sanitize(text: string): string {
  if (text) {
    return sanitizeHtml(text, {
      allowedTags: [
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'blockquote',
        'p',
        'a',
        'ul',
        'ol',
        'li',
        'b',
        'i',
        'strong',
        'em',
        'strike',
        'br',
        'table',
        'thead',
        'caption',
        'tbody',
        'tfoot',
        'tr',
        'th',
        'td',
        'iframe',
        'img',
      ],
      allowedAttributes: {
        a: ['href', 'name', 'target', 'rel'],
        iframe: ['src', 'width', 'height', 'data-name'],

        img: ['src', 'alt', 'title', 'width', 'height'],
        th: ['colspan', 'rowspan', 'scope', 'style'],
        td: ['colspan', 'rowspan', 'scope', 'style'],
      },
      allowedIframeHostnames: ['www.youtube.com', 'www.podbean.com'],
      parser: {
        decodeEntities: false,
      },
      transformTags: {
        div: 'p',
      },
    });
  }
  return text;
}
