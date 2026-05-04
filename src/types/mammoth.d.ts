declare module 'mammoth' {
  interface ConversionResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  interface Options {
    buffer?: Buffer;
    path?: string;
    arrayBuffer?: ArrayBuffer;
  }

  function extractRawText(options: Options): Promise<ConversionResult>;
  function convertToHtml(options: Options): Promise<ConversionResult>;
  function convertToMarkdown(options: Options): Promise<ConversionResult>;
}
