const botonReserva = document.getElementById("botonReserva");

const mensaje = document.getElementById("mensaje");

botonReserva.addEventListener("click", function () {

    mensaje.textContent =
        "El sistema de reservas funciona correctamente.";

});