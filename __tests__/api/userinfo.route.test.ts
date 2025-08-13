/// <reference types="jest" />
jest.setTimeout(8000);

// Mock liviano de NextResponse (evita runtime de Next)
jest.mock('next/server', () => ({
  __esModule: true,
  NextResponse: {
    json: (body: any, init?: any) => ({
      status: (init && (init as any).status) ?? 200,
      json: async () => body,
    }),
  },
}));

const makeReq = () => ({ headers: new Headers() }) as any;
const FAKE_ID = '507f1f77bcf86cd799439011'; // ObjectId válido (24 hex)

describe('GET /api/auth/userinfo', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('401 si no hay token', async () => {
    await new Promise<void>((resolve, reject) => {
      jest.isolateModules(async () => {
        try {
          // Mocks por si el handler intenta tocar DB (no debería en 401)
          jest.doMock('@/lib/dbConnect', () => ({ __esModule: true, default: jest.fn(async () => ({})) }));
          jest.doMock('@/models/cliente', () => ({ __esModule: true, default: { findById: jest.fn() } }));
          jest.doMock('@/models/trabajador', () => ({ __esModule: true, default: { findById: jest.fn() } }));

          // Sin token
          jest.doMock('next-auth/jwt', () => ({
            __esModule: true,
            getToken: jest.fn().mockResolvedValue(null),
          }));

          const { GET } = await import('@/app/api/auth/userinfo/route');
          const res = await GET(makeReq());
          expect(res.status).toBe(401);
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('200 y devuelve datos del token (cliente)', async () => {
    await new Promise<void>((resolve, reject) => {
      jest.isolateModules(async () => {
        try {
          // Mock conexión
          jest.doMock('@/lib/dbConnect', () => ({ __esModule: true, default: jest.fn(async () => ({})) }));

          // Mock modelos: findById().lean() => usuario simulado
          const lean = jest.fn().mockResolvedValue({
            _id: FAKE_ID,
            nombre: 'Ana',
            email: 'a@b.com',
            rol: 'cliente',
          });
          const findById = jest.fn().mockReturnValue({ lean });

          jest.doMock('@/models/cliente', () => ({ __esModule: true, default: { findById } }));
          jest.doMock('@/models/trabajador', () => ({ __esModule: true, default: { findById: jest.fn() } }));

          // Token simulado válido
          jest.doMock('next-auth/jwt', () => ({
            __esModule: true,
            getToken: jest.fn().mockResolvedValue({
              id: FAKE_ID,
              nombre: 'Ana',
              email: 'a@b.com',
              rol: 'cliente',
            }),
          }));

          const { GET } = await import('@/app/api/auth/userinfo/route');
          const res = await GET(makeReq());
          expect(res.status).toBe(200);
const body = await res.json();

expect(body).toMatchObject({
  usuario: {
    id: FAKE_ID,
    nombre: 'Ana',
    email: 'a@b.com',
    rol: 'cliente',
  },
});
          // Verifica que se usó el modelo
          expect(findById).toHaveBeenCalledWith(FAKE_ID);
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });
});
