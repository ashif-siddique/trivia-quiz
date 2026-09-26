```javascript
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

/* =========================
   QUIZ QUESTIONS
========================= */

const questions = [
    {
        question: "Bharat ki rajdhani kya hai?",
        options: ["Mumbai", "New Delhi", "Kolkata", "Chennai"],
        answer: 1
    },
    {
        question: "Bharat ka rashtriya pashu kaunsa hai?",
        options: ["Sher", "Hathi", "Baagh", "Ghoda"],
        answer: 2
    },
    {
        question: "Taj Mahal kis shahar mein hai?",
        options: ["Jaipur", "Agra", "Delhi", "Lucknow"],
        answer: 1
    },
    {
        question: "Bharat ka rashtriya phool kaunsa hai?",
        options: ["Gulab", "Kamal", "Surajmukhi", "Chameli"],
        answer: 1
    },
    {
        question: "Bharat ka rashtriya pakshi kaunsa hai?",
        options: ["Kabootar", "Mor", "Tota", "Hans"],
        answer: 1
    }
];

/* =========================
   ROOMS
========================= */

const rooms = new Map();

function createRoom(roomCode) {
    const room = {
        players: new Map(),
        host: null,
        gameStarted: false,
        currentQuestion: -1,
        answeredPlayers: new Set(),
        nextQuestionTimer: null
    };

    rooms.set(roomCode, room);
    return room;
}

function getPlayers(room) {
    return [...room.players.values()].map(player => ({
        id: player.id,
        username: player.username,
        score: player.score
    }));
}

function sendPlayers(roomCode) {
    const room = rooms.get(roomCode);

    if (!room) return;

    io.to(roomCode).emit("playersUpdate", {
        players: getPlayers(room),
        host: room.host
    });
}

/* =========================
   NEXT QUESTION
========================= */

function startNextQuestion(roomCode) {
    const room = rooms.get(roomCode);

    if (!room) return;

    room.currentQuestion++;
    room.answeredPlayers.clear();

    if (room.currentQuestion >= questions.length) {

        room.gameStarted = false;

        const leaderboard = getPlayers(room).sort(
            (a, b) => b.score - a.score
        );

        io.to(roomCode).emit("gameFinished", {
            leaderboard
        });

        sendPlayers(roomCode);

        return;
    }

    const question = questions[room.currentQuestion];

    /*
       Correct answer client ko nahi bheja ja raha.
       Answer server par validate hoga.
    */

    io.to(roomCode).emit("newQuestion", {
        questionNumber: room.currentQuestion + 1,
        totalQuestions: questions.length,
        question: question.question,
        options: question.options
    });

    sendPlayers(roomCode);
}

/* =========================
   SOCKET.IO
========================= */

io.on("connection", socket => {

    console.log("Player connected:", socket.id);

    /* =========================
       JOIN ROOM
    ========================= */

    socket.on("joinRoom", ({ username, roomCode }) => {

        username = String(username || "").trim();
        roomCode = String(roomCode || "")
            .trim()
            .toUpperCase();

        if (!username || !roomCode) {
            socket.emit(
                "errorMessage",
                "Naam aur room code dono required hain."
            );
            return;
        }

        if (username.length > 20) {
            socket.emit(
                "errorMessage",
                "Naam maximum 20 characters ka ho sakta hai."
            );
            return;
        }

        if (!/^[A-Z0-9]{4,8}$/.test(roomCode)) {
            socket.emit(
                "errorMessage",
                "Room code 4-8 letters/numbers ka hona chahiye."
            );
            return;
        }

        let room = rooms.get(roomCode);

        if (!room) {
            room = createRoom(roomCode);
        }

        /*
           Game start hone ke baad new player join nahi karega.
        */

        if (room.gameStarted) {
            socket.emit(
                "errorMessage",
                "Ye game already start ho chuka hai."
            );
            return;
        }

        /*
           Duplicate username check
        */

        const duplicateName = [...room.players.values()].some(
            player =>
                player.username.toLowerCase() === username.toLowerCase()
        );

        if (duplicateName) {
            socket.emit(
                "errorMessage",
                "Is naam se player already room mein hai."
            );
            return;
        }

        const player = {
            id: socket.id,
            username,
            score: 0
        };

        room.players.set(socket.id, player);

        /*
           First player automatically host.
        */

        if (!room.host) {
            room.host = socket.id;
        }

        socket.join(roomCode);

        socket.data.roomCode = roomCode;

        socket.emit("joinedRoom", {
            username,
            roomCode,
            isHost: room.host === socket.id
        });

        sendPlayers(roomCode);

        console.log(
            `${username} joined room ${roomCode}`
        );
    });

    /* =========================
       START GAME
    ========================= */

    socket.on("startGame", () => {

        const roomCode = socket.data.roomCode;
        const room = rooms.get(roomCode);

        if (!room) return;

        if (room.host !== socket.id) {
            socket.emit(
                "errorMessage",
                "Sirf host game start kar sakta hai."
            );
            return;
        }

        if (room.players.size < 1) {
            socket.emit(
                "errorMessage",
                "Game start karne ke liye player required hai."
            );
            return;
        }

        room.gameStarted = true;
        room.currentQuestion = -1;

        /*
           Scores reset
        */

        for (const player of room.players.values()) {
            player.score = 0;
        }

        startNextQuestion(roomCode);
    });

    /* =========================
       SUBMIT ANSWER
    ========================= */

    socket.on("submitAnswer", ({ answer }) => {

        const roomCode = socket.data.roomCode;
        const room = rooms.get(roomCode);

        if (!room || !room.gameStarted) {
            return;
        }

        /*
           Ek player ek question ka sirf ek answer de sakta hai.
        */

        if (room.answeredPlayers.has(socket.id)) {
            return;
        }

        const question =
            questions[room.currentQuestion];

        const player =
            room.players.get(socket.id);

        if (!question || !player) {
            return;
        }

        room.answeredPlayers.add(socket.id);

        if (Number(answer) === question.answer) {

            player.score += 100;

            socket.emit("answerResult", {
                correct: true,
                message: "Sahi jawab! +100 points"
            });

        } else {

            socket.emit("answerResult", {
                correct: false,
                message: "Galat jawab!"
            });
        }

        sendPlayers(roomCode);

        /*
           Jab sabhi players answer kar dein,
           next question automatically start.
        */

        if (
            room.answeredPlayers.size >=
            room.players.size
        ) {

            room.nextQuestionTimer =
                setTimeout(() => {

                    room.nextQuestionTimer = null;

                    startNextQuestion(roomCode);

                }, 1500);
        }
    });

    /* =========================
       DISCONNECT
    ========================= */

    socket.on("disconnect", () => {

        const roomCode = socket.data.roomCode;

        if (!roomCode) return;

        const room = rooms.get(roomCode);

        if (!room) return;

        room.players.delete(socket.id);
        room.answeredPlayers.delete(socket.id);

        /*
           Agar host chala gaya,
           next player host banega.
        */

        if (room.host === socket.id) {

            const nextHost =
                room.players.keys().next().value;

            room.host = nextHost || null;

            if (nextHost) {

                io.to(nextHost).emit(
                    "becameHost"
                );
            }
        }

        /*
           Room mein koi player nahi bacha.
        */

        if (room.players.size === 0) {

            if (room.nextQuestionTimer) {
                clearTimeout(room.nextQuestionTimer);
            }

            rooms.delete(roomCode);

            console.log(
                `Room ${roomCode} deleted`
            );

            return;
        }

        sendPlayers(roomCode);

        console.log(
            `Player disconnected from ${roomCode}`
        );
    });
});

/* =========================
   HEALTH CHECK
========================= */

app.get("/health", (req, res) => {

    res.json({
        ok: true,
        service: "multiplayer-trivia"
    });
});

/* =========================
   START SERVER
========================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Trivia server running on port ${PORT}`
        );
    }
);
```
