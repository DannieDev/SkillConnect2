jest.mock('@/lib/dbConnect', () => ({ __esModule: true, default: jest.fn(async () => ({})) }));
jest.mock('@/models/cliente', () => ({
  __esModule: true,
  default: function MockCliente(this: any, data: any) { this.data = data; this.save = jest.fn(async () => ({ _id: 'id1', ...data })); }
}));

import dbConnect from '@/lib/dbConnect';
import Cliente from '@/models/cliente';
import { crearCliente, obtenerClientePorEmail, obtenerClientePorId } from '@/services/clienteService';


(Cliente as any).findOne = jest.fn();
(Cliente as any).findById = jest.fn();

describe('clienteService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('crearCliente guarda y devuelve el cliente', async () => {
    const payload = { nombre: 'Ana', email: 'ana@test.com' };
    const res = await crearCliente(payload);
    expect((dbConnect as jest.Mock)).toHaveBeenCalled();
    expect(res).toMatchObject({ _id: 'id1', nombre: 'Ana', email: 'ana@test.com' });
  });

  it('obtenerClientePorEmail llama a findOne', async () => {
    (Cliente as any).findOne.mockResolvedValue({ _id: 'id2', email: 'a@b.com' });
    const res = await obtenerClientePorEmail('a@b.com');
    expect((dbConnect as jest.Mock)).toHaveBeenCalled();
    expect((Cliente as any).findOne).toHaveBeenCalledWith({ email: 'a@b.com' });
    expect(res).toMatchObject({ _id: 'id2', email: 'a@b.com' });
  });

  it('obtenerClientePorId llama a findById', async () => {
    (Cliente as any).findById.mockResolvedValue({ _id: 'id3', email: 'c@d.com' });
    const res = await obtenerClientePorId('id3');
    expect((dbConnect as jest.Mock)).toHaveBeenCalled();
    expect((Cliente as any).findById).toHaveBeenCalledWith('id3');
    expect(res).toMatchObject({ _id: 'id3' });
  });
});
