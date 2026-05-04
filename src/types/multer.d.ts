declare module 'multer' {
  import { RequestHandler, Request } from 'express';

  interface File {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
    destination?: string;
    filename?: string;
    path?: string;
  }

  interface Options {
    storage?: StorageEngine;
    dest?: string;
    limits?: {
      fileSize?: number;
      files?: number;
      fields?: number;
      fieldSize?: number;
      headerPairs?: number;
    };
    fileFilter?: (
      req: Request,
      file: File,
      callback: (error: Error | null, acceptFile: boolean) => void,
    ) => void;
    preservePath?: boolean;
  }

  interface StorageEngine {
    _handleFile(req: Request, file: File, callback: (error?: Error, info?: Partial<File>) => void): void;
    _removeFile(req: Request, file: File, callback: (error: Error | null) => void): void;
  }

  interface Multer {
    single(fieldname: string): RequestHandler;
    array(fieldname: string, maxCount?: number): RequestHandler;
    fields(fields: Array<{ name: string; maxCount?: number }>): RequestHandler;
    none(): RequestHandler;
    any(): RequestHandler;
  }

  function multer(options?: Options): Multer;
  namespace multer {
    function memoryStorage(): StorageEngine;
    function diskStorage(options: { destination?: string; filename?: (req: Request, file: File, cb: (err: Error | null, filename: string) => void) => void }): StorageEngine;
  }

  export = multer;
}

// Extend Express Request with multer file fields
declare namespace Express {
  interface Request {
    file?: import('multer').File;
    files?: import('multer').File[] | { [fieldname: string]: import('multer').File[] };
  }
}
