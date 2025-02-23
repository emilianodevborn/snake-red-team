// server.js
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

// Estructura de datos para salas
// rooms = {
//   roomId1: {
//     host: WebSocket | null,
//     clients: [ WebSocket, WebSocket, ... ]
//   },
//   ...
// }
const rooms = {};

const wss = new WebSocket.Server({ port: 8080 }, () => {
    console.log('Servidor de señalización escuchando en el puerto 8080');
});

wss.on('connection', (ws) => {
    console.log('Nuevo cliente conectado');

    // Propiedad opcional para almacenar el ID de sala y rol
    ws.roomId = null;
    ws.isHost = false;

    ws.on('message', (message) => {
        console.log('Mensaje recibido en el servidor:', message);
        let data;
        try {
            data = JSON.parse(message);
        } catch (err) {
            console.error('Error parseando mensaje:', err);
            return;
        }

        switch (data.type) {

            // Caso: crear una nueva sala (host)
            case 'createRoom':
                // Genera un ID de sala
                const newRoomId = uuidv4();
                rooms[newRoomId] = {
                    host: ws,
                    clients: []
                };
                ws.roomId = newRoomId;
                ws.isHost = true;
                console.log(`Sala creada con ID: ${newRoomId}`);

                // Envía al host la confirmación
                ws.send(JSON.stringify({
                    type: 'roomCreated',
                    roomId: newRoomId
                }));
                break;

            // Caso: unirse a sala existente (cliente)
            case 'joinRoom':
                const { roomId } = data;
                if (!rooms[roomId]) {
                    // Sala no existe
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Sala no existe'
                    }));
                    return;
                }
                // Asigna al cliente
                ws.roomId = roomId;
                ws.isHost = false;
                rooms[roomId].clients.push(ws);
                console.log(`Cliente se unió a la sala: ${roomId}`);

                // Enviamos lista de jugadores al host
                broadcastPlayerList(roomId);
                break;

            // Caso: startGame (host)
            case 'startGame':
                if (ws.isHost && ws.roomId && rooms[ws.roomId]) {
                    console.log(`Host inicia juego en sala: ${ws.roomId}`);
                    // Notifica a todos en la sala que empieza el juego
                    broadcastInRoom(ws.roomId, {
                        type: 'startGame'
                    });
                }
                break;

            // Caso: Mensajes de señalización WebRTC
            case 'offer':
            case 'answer':
            case 'candidate':
                handleWebRTCSignaling(ws, data);
                break;
            case 'gameState':
                // Reenvía el estado a todos los clientes de la sala
                if (ws.roomId && rooms[ws.roomId]) {
                    broadcastInRoom(ws.roomId, data);
                }
                break;
            case 'input':
                // Si el mensaje viene de un cliente, lo reenviamos al host de la sala
                if (!ws.isHost && ws.roomId && rooms[ws.roomId]) {
                    const room = rooms[ws.roomId];
                    if (room.host && room.host.readyState === WebSocket.OPEN) {
                        room.host.send(message);
                        console.log("Reenviando input del cliente al host");
                    }
                }
                break;
            default:
                console.log(`Tipo de mensaje no manejado: ${data.type}`);
                break;
        }
    });

    ws.on('close', () => {
        console.log('Cliente desconectado');
        if (ws.roomId && rooms[ws.roomId]) {
            if (ws.isHost) {
                // Si era el host, cerramos la sala y notificamos a los clientes
                console.log(`Host se desconectó, cerrando sala: ${ws.roomId}`);
                rooms[ws.roomId].clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'roomClosed'
                        }));
                        client.close();
                    }
                });
                delete rooms[ws.roomId];
            } else {
                // Si era cliente, lo removemos de la lista
                rooms[ws.roomId].clients = rooms[ws.roomId].clients.filter(c => c !== ws);
                // Actualizamos la lista de jugadores
                broadcastPlayerList(ws.roomId);
            }
        }
    });
});

// ----------------------------
// Funciones Auxiliares
// ----------------------------

// Envía la lista de jugadores al host y a los clientes
function broadcastPlayerList(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const hostSocket = room.host;
    const clientSockets = room.clients;

    // Obtenemos una lista de IDs o nombres
    const players = [];
    if (hostSocket) {
        players.push({ id: 'host', name: 'Host' });
    }
    clientSockets.forEach((client, index) => {
        players.push({ id: `client-${index}`, name: `Cliente ${index}` });
    });

    // Mensaje
    const msg = JSON.stringify({
        type: 'playerList',
        players
    });

    // Enviamos a host y clientes
    if (hostSocket && hostSocket.readyState === WebSocket.OPEN) {
        hostSocket.send(msg);
    }
    clientSockets.forEach(c => {
        if (c.readyState === WebSocket.OPEN) {
            c.send(msg);
        }
    });
}

// Envía un mensaje JSON a todos (host y clientes) de una sala
function broadcastInRoom(roomId, obj) {
    const room = rooms[roomId];
    if (!room) return;
    const message = JSON.stringify(obj);

    if (room.host && room.host.readyState === WebSocket.OPEN) {
        room.host.send(message);
    }
    room.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Manejo de señalización WebRTC
function handleWebRTCSignaling(ws, data) {
    const roomId = ws.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];

    // Reenviamos la señal al "otro lado":
    // - Si el mensaje viene del host, lo enviamos a todos los clientes
    // - Si viene de un cliente, lo enviamos al host
    if (ws.isHost) {
        // El host envía la señal a cada cliente
        room.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    } else {
        // Un cliente envía la señal al host
        if (room.host && room.host.readyState === WebSocket.OPEN) {
            room.host.send(JSON.stringify(data));
        }
    }
}
