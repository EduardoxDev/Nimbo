import assert from "node:assert/strict";
import test from "node:test";
import { deliverySummary, etaOf, prune, receive } from "../src/deliveries/deliveries.ts";

const NOW = new Date(2026, 10, 5, 19, 0, 0).getTime();
const phone = (title, body = "") => ({ app: "Vincular ao Celular", title, body });
const copy = {
  stage: {
    food: { confirmed: "Pedido confirmado", preparing: "Preparando", onTheWay: "A caminho", arriving: "Chegando", arrived: "Chegou!", cancelled: "Cancelado" },
    ride: { confirmed: "Motorista encontrado", preparing: "Preparando", onTheWay: "Motorista a caminho", arriving: "Chegando", arrived: "Motorista chegou", cancelled: "Cancelada" },
    package: { confirmed: "Confirmado", preparing: "Preparando", onTheWay: "Em trânsito", arriving: "Saiu para entrega", arrived: "Entregue", cancelled: "Cancelado" },
  },
  minutes: (count) => `~${count} min`,
};

test("an iFood order goes from preparing to arrived on the island", () => {
  let { list, handled } = receive([], phone("iFood", "Seu pedido está sendo preparado. Previsão: 30-40 min"), NOW);
  assert.equal(handled, true);
  assert.equal(list[0].stage, "preparing");
  assert.equal(list[0].etaAt, NOW + 40 * 60_000);
  ({ list } = receive(list, phone("iFood", "Seu pedido saiu para entrega e chega em 12 min"), NOW + 20 * 60_000));
  assert.equal(list.length, 1);
  assert.equal(list[0].stage, "arriving");
  const summary = deliverySummary(list, copy, NOW + 20 * 60_000);
  assert.equal(summary.text, "🛵 iFood · Chegando · ~12 min");
  assert.equal(summary.progress, 0.85);
  const done = receive(list, phone("iFood", "Seu pedido chegou! Bom apetite"), NOW + 32 * 60_000);
  assert.equal(done.list[0].stage, "arrived");
  assert.equal(done.landed.name, "iFood");
  // The same news twice does not land twice.
  assert.equal(receive(done.list, phone("iFood", "Pedido entregue"), NOW + 33 * 60_000).landed, null);
});

test("rides, and Uber Eats is not Uber", () => {
  const ride = receive([], phone("Uber", "Seu motorista está a caminho. Chega às 19:08"), NOW).list[0];
  assert.deepEqual([ride.name, ride.kind, ride.stage, ride.etaAt], ["Uber", "ride", "onTheWay", NOW + 8 * 60_000]);
  assert.equal(receive([], phone("Uber Eats", "Your order is on its way"), NOW).list[0].name, "Uber Eats");
  assert.equal(receive([], { app: "99", title: "Motorista encontrado", body: "Corolla prata" }, NOW).list[0].stage, "confirmed");
  assert.equal(receive([], phone("Uber", "Seu motorista está esperando"), NOW).list[0].stage, "arrived");
});

test("packages only show the day they go out", () => {
  assert.equal(receive([], phone("Mercado Livre", "Seu pacote está a caminho"), NOW).handled, false);
  assert.equal(receive([], phone("Mercado Livre", "Seu pacote será entregue amanhã"), NOW).handled, false);
  assert.equal(receive([], phone("Shopee", "Seu pedido será entregue hoje"), NOW).list[0].stage, "arriving");
  assert.equal(receive([], phone("Correios", "Objeto saiu para entrega ao destinatário"), NOW).list[0].stage, "arriving");
  assert.equal(receive([], phone("Amazon", "Delivered: your package was left at the front door"), NOW).list[0].stage, "arrived");
});

test("other notifications stay plain notices", () => {
  assert.equal(receive([], phone("WhatsApp", "Mãe: chegou em casa?"), NOW).handled, false);
  assert.equal(receive([], phone("iFood", "Cupom de R$ 20 só hoje!"), NOW).handled, false);
  // A bank notice that mentions iFood is not an iFood order.
  assert.equal(receive([], phone("Nubank", "Compra aprovada de R$ 32,90 no iFood"), NOW).handled, false);
});

test("times and clean-up", () => {
  assert.equal(etaOf("chega até 19h40", NOW), NOW + 40 * 60_000);
  assert.equal(etaOf("chega às 18:30", NOW), null);
  assert.equal(etaOf("nada aqui", NOW), null);
  const { list } = receive([], phone("iFood", "Pedido entregue"), NOW);
  assert.equal(prune(list, NOW + 60_000).length, 1);
  assert.equal(prune(list, NOW + 4 * 60_000).length, 0);
  const late = receive([], phone("Rappi", "Pedido confirmado"), NOW).list;
  assert.equal(prune(late, NOW + 2 * 60 * 60_000).length, 0);
});
