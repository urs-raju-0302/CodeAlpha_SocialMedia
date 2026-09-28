const express = require("express");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { DatabaseSync } = require("node:sqlite");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "codealpha-social-secret";

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "social.db"));
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    bio TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    UNIQUE(post_id, user_id),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_id INTEGER NOT NULL,
    following_id INTEGER NOT NULL,
    UNIQUE(follower_id, following_id),
    CHECK(follower_id <> following_id),
    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function createToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: "Authentication required" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    bio: row.bio || "",
    created_at: row.created_at
  };
}

app.post("/api/register", (req, res) => {
  const { name, email, password } = req.body;

  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: "Name, email and password are required" });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(
      "INSERT INTO users (name, email, password) VALUES (?, ?, ?)"
    ).run(name.trim(), email.trim().toLowerCase(), hash);

    const user = db.prepare(
      "SELECT id, name, email, bio, created_at FROM users WHERE id = ?"
    ).get(Number(result.lastInsertRowid));

    res.status(201).json({ user: publicUser(user), token: createToken(user) });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "Email is already registered" });
    }
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(
    email?.trim().toLowerCase()
  );

  if (!user || !bcrypt.compareSync(password || "", user.password)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  res.json({
    user: publicUser(user),
    token: createToken(user)
  });
});

app.get("/api/me", auth, (req, res) => {
  const user = db.prepare(
    "SELECT id, name, email, bio, created_at FROM users WHERE id = ?"
  ).get(req.user.id);

  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: publicUser(user) });
});

app.put("/api/profile", auth, (req, res) => {
  const { name, bio } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: "Name is required" });
  }

  db.prepare("UPDATE users SET name = ?, bio = ? WHERE id = ?")
    .run(name.trim(), (bio || "").trim(), req.user.id);

  const user = db.prepare(
    "SELECT id, name, email, bio, created_at FROM users WHERE id = ?"
  ).get(req.user.id);

  res.json({ user: publicUser(user) });
});

app.get("/api/users", auth, (req, res) => {
  const users = db.prepare(`
    SELECT
      u.id, u.name, u.email, u.bio, u.created_at,
      (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS followers,
      (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) AS following,
      EXISTS(
        SELECT 1 FROM follows f
        WHERE f.follower_id = ? AND f.following_id = u.id
      ) AS is_following
    FROM users u
    ORDER BY u.created_at DESC
  `).all(req.user.id);

  res.json({ users });
});

app.get("/api/users/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare(`
    SELECT
      id, name, email, bio, created_at,
      (SELECT COUNT(*) FROM follows WHERE following_id = users.id) AS followers,
      (SELECT COUNT(*) FROM follows WHERE follower_id = users.id) AS following
    FROM users
    WHERE id = ?
  `).get(id);

  if (!user) return res.status(404).json({ error: "User not found" });

  const posts = db.prepare(`
    SELECT
      p.id, p.content, p.created_at,
      u.id AS user_id, u.name AS user_name,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments,
      EXISTS(
        SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?
      ) AS liked
    FROM posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(req.user.id, id);

  res.json({ user, posts });
});

app.post("/api/follow/:id", auth, (req, res) => {
  const targetId = Number(req.params.id);

  if (targetId === req.user.id) {
    return res.status(400).json({ error: "You cannot follow yourself" });
  }

  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(targetId);
  if (!target) return res.status(404).json({ error: "User not found" });

  const existing = db.prepare(
    "SELECT id FROM follows WHERE follower_id = ? AND following_id = ?"
  ).get(req.user.id, targetId);

  if (existing) {
    db.prepare("DELETE FROM follows WHERE id = ?").run(existing.id);
    return res.json({ following: false });
  }

  db.prepare(
    "INSERT INTO follows (follower_id, following_id) VALUES (?, ?)"
  ).run(req.user.id, targetId);

  res.json({ following: true });
});

app.get("/api/posts", auth, (req, res) => {
  const posts = db.prepare(`
    SELECT
      p.id, p.content, p.created_at,
      u.id AS user_id, u.name AS user_name,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments,
      EXISTS(
        SELECT 1 FROM likes l
        WHERE l.post_id = p.id AND l.user_id = ?
      ) AS liked
    FROM posts p
    JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC
  `).all(req.user.id);

  res.json({ posts });
});

app.post("/api/posts", auth, (req, res) => {
  const content = req.body.content?.trim();

  if (!content) return res.status(400).json({ error: "Post content is required" });

  const result = db.prepare(
    "INSERT INTO posts (user_id, content) VALUES (?, ?)"
  ).run(req.user.id, content);

  const post = db.prepare(`
    SELECT p.id, p.content, p.created_at, u.id AS user_id, u.name AS user_name,
      0 AS likes, 0 AS comments, 0 AS liked
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE p.id = ?
  `).get(Number(result.lastInsertRowid));

  res.status(201).json({ post });
});

app.post("/api/posts/:id/like", auth, (req, res) => {
  const postId = Number(req.params.id);
  const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(postId);

  if (!post) return res.status(404).json({ error: "Post not found" });

  const existing = db.prepare(
    "SELECT id FROM likes WHERE post_id = ? AND user_id = ?"
  ).get(postId, req.user.id);

  if (existing) {
    db.prepare("DELETE FROM likes WHERE id = ?").run(existing.id);
  } else {
    db.prepare(
      "INSERT INTO likes (post_id, user_id) VALUES (?, ?)"
    ).run(postId, req.user.id);
  }

  const count = db.prepare(
    "SELECT COUNT(*) AS count FROM likes WHERE post_id = ?"
  ).get(postId).count;

  res.json({ liked: !existing, likes: count });
});

app.get("/api/posts/:id/comments", auth, (req, res) => {
  const comments = db.prepare(`
    SELECT c.id, c.content, c.created_at, u.id AS user_id, u.name AS user_name
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.post_id = ?
    ORDER BY c.created_at ASC
  `).all(Number(req.params.id));

  res.json({ comments });
});

app.post("/api/posts/:id/comments", auth, (req, res) => {
  const content = req.body.content?.trim();
  const postId = Number(req.params.id);

  if (!content) return res.status(400).json({ error: "Comment is required" });

  const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
  if (!post) return res.status(404).json({ error: "Post not found" });

  const result = db.prepare(
    "INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)"
  ).run(postId, req.user.id, content);

  const comment = db.prepare(`
    SELECT c.id, c.content, c.created_at, u.id AS user_id, u.name AS user_name
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.id = ?
  `).get(Number(result.lastInsertRowid));

  res.status(201).json({ comment });
});

app.delete("/api/posts/:id", auth, (req, res) => {
  const post = db.prepare(
    "SELECT id FROM posts WHERE id = ? AND user_id = ?"
  ).get(Number(req.params.id), req.user.id);

  if (!post) return res.status(404).json({ error: "Post not found" });

  db.prepare("DELETE FROM posts WHERE id = ?").run(post.id);
  res.json({ message: "Post deleted" });
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`CodeAlpha Social Media running at http://localhost:${PORT}`);
});
