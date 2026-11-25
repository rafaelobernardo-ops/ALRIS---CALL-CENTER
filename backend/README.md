# Backend ALRIS — Canal de Atendimento

Servidor local em Python responsável por servir o portal estático e expor endpoints JSON de saúde e planos:

- `GET /api/health` — Status do serviço
- `GET /api/plans` — Lista dos planos de assinatura (Starter, Pro Growth, Enterprise Scale)

## Como executar

```bash
python3 backend/server.py
```
