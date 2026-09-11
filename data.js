/* Datos editables de la demostración. No se necesitan imágenes ni servicios externos. */
(function (global) {
  'use strict';

  global.NovaData = {
    services: [
      { id: 'corte-caballero', name: 'Corte caballero', price: 18, duration: 30, category: 'Corte', professionals: ['carlos'], description: 'Un corte preciso, adaptado a tu estilo y a tu día a día.' },
      { id: 'corte-barba', name: 'Corte + barba', price: 25, duration: 45, category: 'Corte', professionals: ['carlos'], description: 'Corte, forma y acabado de barba para un conjunto cuidado.' },
      { id: 'corte-mujer', name: 'Corte mujer', price: 25, duration: 45, category: 'Corte', professionals: ['laura', 'maria'], description: 'Damos forma y movimiento a tu cabello, escuchando lo que buscas.' },
      { id: 'lavado-corte-peinado', name: 'Lavado + corte + peinado', price: 35, duration: 60, category: 'Corte', professionals: ['laura', 'maria'], description: 'Una puesta a punto completa, desde el lavado hasta el acabado.' },
      { id: 'peinado', name: 'Peinado', price: 20, duration: 30, category: 'Peinado', professionals: ['maria'], description: 'Ondas, volumen o un acabado pulido para cualquier ocasión.' },
      { id: 'tinte-raiz', name: 'Tinte de raíz', price: 40, duration: 90, category: 'Color', professionals: ['laura', 'maria'], description: 'Renovamos el color de la raíz para un tono uniforme y natural.' },
      { id: 'color-completo', name: 'Color completo', price: 55, duration: 120, category: 'Color', professionals: ['laura', 'maria'], description: 'Un color con personalidad, elegido para acompañar tus rasgos.' },
      { id: 'mechas', name: 'Mechas', price: 65, duration: 120, category: 'Color', professionals: ['laura'], description: 'Puntos de luz y dimensión con un acabado que se integra en tu pelo.' },
      { id: 'balayage', name: 'Balayage', price: 80, duration: 150, category: 'Color', professionals: ['laura'], description: 'Luz de medios a puntas y una transición suave, hecha a medida.' },
      { id: 'tratamiento', name: 'Tratamiento capilar', price: 30, duration: 45, category: 'Cuidado', professionals: ['maria'], description: 'Un momento de cuidado para mejorar la suavidad y el brillo.' }
    ],
    professionals: [
      { id: 'laura', name: 'Laura', description: 'Color con intención y cortes que realzan tu personalidad. Le encantan los acabados luminosos y naturales.', specialties: ['Balayage', 'Mechas', 'Coloración', 'Corte mujer'] },
      { id: 'maria', name: 'María', description: 'Escucha, detalle y mucho cuidado. Te ayuda a encontrar un corte y un peinado que te resulten cómodos.', specialties: ['Corte mujer', 'Peinado', 'Tratamientos', 'Coloración'] },
      { id: 'carlos', name: 'Carlos', description: 'Líneas limpias, textura y atención al acabado. Cortes y barbas pensados para tu estilo de vida.', specialties: ['Corte caballero', 'Barba', 'Corte + barba'] }
    ],
    /* Todos los nombres y testimonios son ficticios. La interfaz los identifica como demo. */
    reviews: [
      { name: 'Lucía M.', serviceId: 'balayage', text: 'Buscaba un cambio suave y el resultado tiene justo la luz que imaginaba.' },
      { name: 'Javier R.', serviceId: 'corte-caballero', text: 'Un corte cómodo de llevar y con el acabado que había pedido.' },
      { name: 'Elena G.', serviceId: 'corte-mujer', text: 'Me escucharon con calma y encontré un corte que va conmigo.' },
      { name: 'Sofía P.', serviceId: 'mechas', text: 'Las mechas se integran con mi tono y dan una luz muy bonita.' },
      { name: 'Ana L.', serviceId: 'peinado', text: 'Un peinado sencillo y elegante. Salí lista para mi celebración.' },
      { name: 'Pablo D.', serviceId: 'corte-barba', text: 'Corte y barba equilibrados, con mucha atención a los detalles.' },
      { name: 'Clara T.', serviceId: 'lavado-corte-peinado', text: 'Me gustó dedicarme un rato y salir con el pelo renovado.' },
      { name: 'Marta S.', serviceId: 'tinte-raiz', text: 'El tono de la raíz quedó integrado con el resto del cabello.' },
      { name: 'Nuria C.', serviceId: 'color-completo', text: 'Me ayudaron a elegir un color con el que me siento muy cómoda.' },
      { name: 'Irene V.', serviceId: 'tratamiento', text: 'Mi pelo quedó suave y aprendí cómo cuidarlo mejor en casa.' },
      { name: 'Alba F.', serviceId: 'balayage', text: 'Quería unas puntas más luminosas sin un cambio brusco. Me encanta la idea.' },
      { name: 'Diego H.', serviceId: 'corte-caballero', text: 'Un estilo fácil de mantener y un trato cercano de principio a fin.' },
      { name: 'Celia A.', serviceId: 'corte-mujer', text: 'El nuevo largo y las capas le dan mucho movimiento a mi pelo.' },
      { name: 'Patricia N.', serviceId: 'mechas', text: 'Un acabado natural, con reflejos suaves y bien repartidos.' },
      { name: 'Beatriz E.', serviceId: 'peinado', text: 'Pedí unas ondas con movimiento y el acabado fue muy cuidado.' },
      { name: 'Álvaro B.', serviceId: 'corte-barba', text: 'Encontramos la forma de barba que mejor acompaña a mi corte.' },
      { name: 'Rocío J.', serviceId: 'lavado-corte-peinado', text: 'Un momento agradable para cuidar el cabello y probar otro acabado.' },
      { name: 'Teresa O.', serviceId: 'tinte-raiz', text: 'Me explicaron el proceso y el resultado quedó muy uniforme.' },
      { name: 'Paula I.', serviceId: 'color-completo', text: 'El cambio de color tiene el tono cálido que estaba buscando.' },
      { name: 'Lidia Z.', serviceId: 'tratamiento', text: 'Un cuidado agradable para devolver suavidad y brillo a mi cabello.' }
    ],
    business: {
      name: 'NOVA Hair Studio',
      address: 'Calle Ejemplo 23, Madrid',
      phone: '+34 910 000 000',
      email: 'hola@nova.example',
      hours: {
        1: { start: 540, end: 1200 },
        2: { start: 540, end: 1200 },
        3: { start: 540, end: 1200 },
        4: { start: 540, end: 1200 },
        5: { start: 540, end: 1200 },
        6: { start: 540, end: 840 }
      },
      slotInterval: 30
    }
  };
}(typeof window !== 'undefined' ? window : globalThis));
