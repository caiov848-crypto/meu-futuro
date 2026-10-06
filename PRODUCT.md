# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Pessoa física gerenciando finanças pessoais que busca previsibilidade diária e controle do futuro sem a burocracia de planilhas complexas ou aplicativos de orçamento retrospectivos.

## Product Purpose
Prover previsão financeira pessoal proativa respondendo com precisão matemática a três perguntas fundamentais:
1. Quanto posso gastar hoje?
2. Quanto vou ter em determinada data futura?
3. Quanto preciso juntar para realizar um gasto/meta?

O sucesso é o usuário ter tranquilidade e clareza imediata sobre o impacto presente de qualquer decisão financeira futura, sem surpresas no fim do mês.

## Positioning
Diferente dos gerenciadores financeiros tradicionais focados em contabilidade do passado (extratos retroativos, categorização exaustiva), o Meu Futuro é um simulador e oráculo prospectivo: tudo é calculado a partir de um motor financeiro determinístico puro com suporte a recorrências virtuais, graus de certeza configuráveis (Confirmada, Provável, Prevista) e foco no limite diário seguro de gastos.

## Operating Context
- Aplicativo PWA mobile-first e offline-first, desenhado para consultas rápidas e registros em uma mão só no celular.
- Dados guardados localmente no aparelho (IndexedDB via Dexie), com sincronização opcional e resiliente na nuvem (Supabase).
- Uso em momentos de decisão de compra imediata ("posso comprar isso hoje?"), planejamento de metas de médio/longo prazo e revisão periódica do fluxo de caixa.

## Capabilities and Constraints
- **Motor Financeiro Determinístico**: localizado em `src/engine/`, com funções puras como única fonte de verdade. As telas e componentes de UI nunca realizam cálculos financeiros por conta própria.
- **Valores e Datas**: valores monetários representados estritamente em centavos inteiros (evitando imprecisão de ponto flutuante); datas padronizadas no formato ISO `YYYY-MM-DD`.
- **Recorrências Virtuais**: ocorrências periódicas (semanal, mensal, anual) não poluem o banco antecipadamente; viram registros concretos apenas quando liquidadas/pagas ou editadas individualmente.
- **Pesos de Certeza**: lançamentos possuem níveis de certeza (`Confirmada`, `Provável`, `Prevista`) com pesos customizáveis nas configurações para cálculo ponderado de cenários.
- **Simulações Voláteis**: simulações e cálculos de "quanto preciso juntar" são recalculados dinamicamente em memória e não persistem registros espúrios.
- **Exclusão Lógica**: registros possuem `updatedAt` e `deletedAt` para suportar reconciliação em sincronização futura.

## Brand Commitments
- **Nome**: Meu Futuro.
- **Tom de Voz**: Direto, acolhedor, transparente, sóbrio e encorajador. Linguagem clara em português do Brasil sem jargões contábeis agressivos.
- **Visual e Filosofia**: Interface focada no essencial, mobile-first, com contraste nítido, navegação por abas inferiores (`Hoje`, `Previsão`, `Tabela`, `Planejar`, `Mais`) e botão de ação flutuante (FAB) central para novos lançamentos rápidos.

## Evidence on Hand
- Código-fonte funcional em React 19, TypeScript, Vite e Dexie (`src/App.tsx`, `src/engine/`, `src/data/`, `src/features/`).
- Documentação técnica e arquitetural consolidada em `README.md`.
- Suíte de testes automatizados com Vitest validando o motor financeiro e operações (`src/test/`, `npm test`).

## Product Principles
1. **Previsão supera retrovisor**: Mais importante do que catalogar onde o dinheiro já foi gasto é saber exatamente como o dinheiro se comportará amanhã e até o fim do mês.
2. **Determinismo sem concessões**: Cálculos financeiros são executados exclusivamente por funções puras no motor central (`src/engine`), garantindo consistência matemática absoluta em toda a interface.
3. **Privacidade e autonomia local-first**: O usuário é dono dos seus dados; o app funciona 100% offline no dispositivo e qualquer sincronização em nuvem é complementar.
4. **Decisão em um relance**: Informações críticas (ex: saldo real e quanto posso gastar hoje) devem ser legíveis em frações de segundo, sem fricção ou navegação convoluta.

## Accessibility & Inclusion
- Layout mobile-first responsivo com suporte a toque confortável (touch targets adequados no FAB e barra de abas).
- Tipografia legível utilizando a fonte Inter com pesos bem hierarquizados.
- Semântica de botões e marcações ARIA em abas e modais de lançamento (`aria-label`, `aria-current`).
