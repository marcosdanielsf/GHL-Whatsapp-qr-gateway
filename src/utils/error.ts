/**
 * Error utilities — helpers para lidar com erros sem `any`
 */

/**
 * Extrai mensagem de qualquer tipo de erro de forma segura.
 * Cobre: Error, string, { message: string }, unknown.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    error !== null &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as Record<string, unknown>).message === "string"
  ) {
    return (error as Record<string, unknown>).message as string;
  }
  return String(error);
}

/**
 * Extrai stack trace de forma segura.
 */
export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) return error.stack;
  return undefined;
}
