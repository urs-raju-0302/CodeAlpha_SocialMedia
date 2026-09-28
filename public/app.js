const state = {
  token: localStorage.getItem("socialToken"),
  user: null
};

const $ = (id) => document.getElementById(id);

function headers() {
  return {
    "Content-Type": "application/json",
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
  };
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function showMessage(id, message) {
  $(id).textContent = message;
}

function setLoggedIn(user, token) {
  state.user = user;
  state.token = token;
  localStorage.setItem("socialToken", token);

  $("authSection").classList.add("hidden");
  $("appSection").classList.remove("hidden");
  $("userArea").classList.remove("hidden");
  $("welcome").textContent = `Hi, ${user.name}`;

  loadApp();
}

function logout() {
  state.user = null;
  state.token = null;
  localStorage.removeItem("socialToken");

  $("authSection").classList.remove("hidden");
  $("appSection").classList.add("hidden");
  $("userArea").classList.add("hidden");
}

async function loadApp() {
  try {
    const me = await api("/api/me");
    state.user = me.user;
    $("welcome").textContent = `Hi, ${state.user.name}`;

    await Promise.all([loadPosts(), loadPeople(), renderMyProfile()]);
  } catch {
    logout();
  }
}

async function loadPosts() {
  const { posts } = await api("/api/posts");
  const container = $("posts");

  if (!posts.length) {
    container.innerHTML = "<p>No posts yet. Create the first post.</p>";
    return;
  }

  container.innerHTML = posts.map((post) => `
    <article class="post">
      <div class="post-header">
        <span class="post-author">${escapeHtml(post.user_name)}</span>
        <span class="post-date">${formatDate(post.created_at)}</span>
      </div>

      <div class="post-content">${escapeHtml(post.content)}</div>

      <div class="post-actions">
        <button class="${post.liked ? "liked" : ""}"
          onclick="toggleLike(${post.id})">
          ${post.liked ? "Unlike" : "Like"} (${post.likes})
        </button>
        <button onclick="loadComments(${post.id})">
          Comments (${post.comments})
        </button>
        ${post.user_id === state.user.id
          ? `<button class="danger" onclick="deletePost(${post.id})">Delete</button>`
          : ""}
      </div>

      <div id="comments-${post.id}" class="comments"></div>
    </article>
  `).join("");
}

async function loadPeople() {
  const { users } = await api("/api/users");
  const container = $("peopleList");

  const people = users.filter((u) => u.id !== state.user.id);

  if (!people.length) {
    container.innerHTML = "<p>Create another account to test following.</p>";
    return;
  }

  container.innerHTML = people.map((person) => `
    <div class="person">
      <div class="person-name">${escapeHtml(person.name)}</div>
      <div class="person-bio">${escapeHtml(person.bio || "No bio")}</div>
      <div class="profile-stats">
        <span>Followers: ${person.followers}</span>
        <span>Following: ${person.following}</span>
      </div>
      <button onclick="toggleFollow(${person.id})">
        ${person.is_following ? "Unfollow" : "Follow"}
      </button>
      <button class="secondary" onclick="viewProfile(${person.id})">Profile</button>
    </div>
  `).join("");
}

async function renderMyProfile() {
  const { user } = await api("/api/me");

  $("myProfile").innerHTML = `
    <strong>${escapeHtml(user.name)}</strong>
    <p>${escapeHtml(user.bio || "No bio yet.")}</p>
    <small>${escapeHtml(user.email)}</small>
  `;
}

$("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const data = await api("/api/register", {
      method: "POST",
      body: JSON.stringify({
        name: $("regName").value,
        email: $("regEmail").value,
        password: $("regPassword").value
      })
    });

    showMessage("registerMsg", "Account created successfully.");
    setLoggedIn(data.user, data.token);
    event.target.reset();
  } catch (error) {
    showMessage("registerMsg", error.message);
  }
});

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        email: $("loginEmail").value,
        password: $("loginPassword").value
      })
    });

    showMessage("loginMsg", "Login successful.");
    setLoggedIn(data.user, data.token);
    event.target.reset();
  } catch (error) {
    showMessage("loginMsg", error.message);
  }
});

$("postForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await api("/api/posts", {
      method: "POST",
      body: JSON.stringify({ content: $("postContent").value })
    });

    $("postContent").value = "";
    await loadPosts();
  } catch (error) {
    alert(error.message);
  }
});

$("refreshBtn").addEventListener("click", loadApp);
$("logoutBtn").addEventListener("click", logout);

$("profileBtn").addEventListener("click", async () => {
  const { user } = await api("/api/me");
  $("profileName").value = user.name;
  $("profileBio").value = user.bio || "";
  $("profileMsg").textContent = "";
  $("profileModal").classList.remove("hidden");
});

$("closeModal").addEventListener("click", () => {
  $("profileModal").classList.add("hidden");
});

$("profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const data = await api("/api/profile", {
      method: "PUT",
      body: JSON.stringify({
        name: $("profileName").value,
        bio: $("profileBio").value
      })
    });

    state.user = data.user;
    $("welcome").textContent = `Hi, ${state.user.name}`;
    $("profileModal").classList.add("hidden");
    await Promise.all([renderMyProfile(), loadPeople(), loadPosts()]);
  } catch (error) {
    showMessage("profileMsg", error.message);
  }
});

async function toggleLike(postId) {
  try {
    await api(`/api/posts/${postId}/like`, { method: "POST" });
    await loadPosts();
  } catch (error) {
    alert(error.message);
  }
}

async function toggleFollow(userId) {
  try {
    await api(`/api/follow/${userId}`, { method: "POST" });
    await loadPeople();
  } catch (error) {
    alert(error.message);
  }
}

async function loadComments(postId) {
  const container = $(`comments-${postId}`);

  try {
    const { comments } = await api(`/api/posts/${postId}/comments`);

    container.innerHTML = `
      ${comments.map((comment) => `
        <div class="comment">
          <strong>${escapeHtml(comment.user_name)}</strong>
          <span>${escapeHtml(comment.content)}</span>
        </div>
      `).join("")}

      <form class="comment-form" onsubmit="addComment(event, ${postId})">
        <input id="comment-input-${postId}" placeholder="Write a comment..." required>
        <button type="submit">Comment</button>
      </form>
    `;
  } catch (error) {
    alert(error.message);
  }
}

async function addComment(event, postId) {
  event.preventDefault();

  const input = $(`comment-input-${postId}`);

  try {
    await api(`/api/posts/${postId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content: input.value })
    });

    await loadComments(postId);
    await loadPosts();
  } catch (error) {
    alert(error.message);
  }
}

async function deletePost(postId) {
  if (!confirm("Delete this post?")) return;

  try {
    await api(`/api/posts/${postId}`, { method: "DELETE" });
    await loadPosts();
  } catch (error) {
    alert(error.message);
  }
}

async function viewProfile(userId) {
  try {
    const { user, posts } = await api(`/api/users/${userId}`);

    alert(
      `${user.name}\n\n` +
      `${user.bio || "No bio"}\n\n` +
      `Followers: ${user.followers}\n` +
      `Following: ${user.following}\n` +
      `Posts: ${posts.length}`
    );
  } catch (error) {
    alert(error.message);
  }
}

function formatDate(value) {
  return new Date(value.replace(" ", "T") + "Z").toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

if (state.token) {
  loadApp();
}
