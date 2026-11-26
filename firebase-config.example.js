// Configuração do Firebase (modo nuvem).
//
// 1. Copie este arquivo para `firebase-config.js` (mesma pasta).
// 2. Cole os dados do seu app Web: Console do Firebase → Configurações do projeto → Seus apps.
// 3. Recarregue a loja e o painel: eles passam a usar Auth + Firestore + Storage.
//
// Sem o arquivo `firebase-config.js`, o site funciona em MODO LOCAL (demonstração),
// com os dados salvos apenas no navegador.
//
// Observação: estes valores não são secretos (ficam visíveis no navegador). A segurança
// vem das regras em `firestore.rules` e `storage.rules`.

export const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "seu-projeto.firebaseapp.com",
  projectId: "seu-projeto",
  storageBucket: "seu-projeto.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000000000",
};
