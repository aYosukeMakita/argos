export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function assertNonEmpty(value: string, fieldName: string): void {
  if (!value.trim()) {
    throw new AppError(400, `${fieldName} must not be empty`, 'VALIDATION_ERROR')
  }
}
