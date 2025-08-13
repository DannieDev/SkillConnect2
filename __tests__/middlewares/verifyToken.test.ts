import jwt from 'jsonwebtoken';
import { verifyToken } from '@/middlewares/verifyToken';

describe('verifyToken', () => {
  it('lanza error si token no enviado', () => {
    expect(() => verifyToken('' as any)).toThrow('Token no enviado');
  });

  it('retorna payload válido', () => {
    const token = jwt.sign({ id: '123', nombre: 'Tilin', email: 't@t.com', rol: 'cliente' }, process.env.JWT_SECRET as string);
    const decoded = verifyToken(token);
    expect(decoded).toMatchObject({ id: '123', nombre: 'Tilin', email: 't@t.com', rol: 'cliente' });
  });

  it('lanza error si token inválido', () => {
    expect(() => verifyToken('invalid.token')).toThrow('Token inválido');
  });
});
