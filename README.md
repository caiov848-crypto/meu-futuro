# Meu Futuro

App de previsão financeira pessoal. Responde três perguntas:

1. **Quanto posso gastar hoje?**
2. **Quanto vou ter em determinada data?**
3. **Quanto preciso juntar para um gasto?**

PWA mobile-first, offline-first, dados guardados no aparelho (IndexedDB).

## Rodar

```bash
npm install
npm run dev      # desenvolvimento
npm test         # testes do motor e das operações
npm run build    # build de produção (PWA)
```

## Arquitetura

```
src/
  domain/      tipos e dados padrão (categorias, rótulos)
  engine/      MOTOR FINANCEIRO — funções puras, única fonte de verdade
    forecast.ts     saldo real, eventos pendentes, previsão dia a dia
    model.ts        buildFinanceModel + consultas (saldo projetado, explicação, pior dia)
    simulators.ts   quanto posso gastar, posso gastar?, quanto preciso juntar, metas
    alerts.ts       "precisa da sua atenção"
    recurrence.ts   expansão de séries (semanal, mensal, anual)
    suggestions.ts  sugestões a partir do histórico
  data/
    operations.ts   escritas puras (criar, editar/excluir série: só este / próximos / todos)
    repository.ts   aplica as operações no IndexedDB (Dexie), backup
    db.ts, seed.ts
  state/       FinanceProvider (calcula o modelo 1x por mudança) e UI (abas, sheets, toasts)
  ui/          primitivas de interface
  features/    today, forecast, plan, more, entry, onboarding
```

Regras importantes:

- Dinheiro em **centavos inteiros**; datas como `YYYY-MM-DD`.
- As telas nunca fazem contas: tudo vem de `engine/`.
- Simulações não gravam nada. Metas guardam só o pedido (valor, data) e são recalculadas sempre.
- Registros têm `updatedAt` e `deletedAt` (exclusão lógica), prontos para sincronização futura.
- Recorrências são virtuais: ocorrências só viram registro quando pagas ou editadas individualmente.
- Certeza (Confirmada/Provável/Prevista) tem pesos configuráveis em `settings.certaintyWeights`.
