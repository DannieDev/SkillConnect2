// Mock mínimo para evitar runtime de Next
export const NextResponse = {
  json: (body: any, init?: any) => ({
    status: (init && (init as any).status) ?? 200,
    json: async () => body,
  }),
};

// Para que la importación de tipo no reviente:
export type NextRequest = any;
