// Mock por defecto: sin token (lo sobreescribimos con jest.spyOn en cada test)
export async function getToken(_: any): Promise<any> {
  return null;
}
