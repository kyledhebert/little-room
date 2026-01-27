export const shiftHeadingLevels = (html: string, shift: number): string => {
  if (!html || shift === 0) return html;

  return html.replace(
    /<(\/?)h([1-6])([^>]*)?>/gi,
    (_match, closingSlash: string, level: string, attrs: string) => {
      const nextLevel = Math.min(6, Math.max(1, Number(level) + shift));
      const safeAttrs = attrs ?? "";
      return `<${closingSlash}h${nextLevel}${safeAttrs}>`;
    }
  );
};
