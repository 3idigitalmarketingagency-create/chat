/**
 * FlyingFish Chatbot Widget — Deep Ocean Premium Edition
 *
 * <link rel="stylesheet" href="widget.css">
 * <script src="widget.js" data-api="https://your-api.com" defer></script>
 *
 * Attributes:
 *   data-api       — Backend API URL (required)
 *   data-position  — "right" | "left"
 *   data-avatar    — Avatar image URL
 */
(function () {
  "use strict";

  var s = document.currentScript || document.querySelector("script[data-api]");

  var C = {
    api:  s && s.getAttribute("data-api")  || "http://localhost:3001",
    pos:  s && s.getAttribute("data-position") || "right",
    avatar: s && s.getAttribute("data-avatar") ||
      "https://lightcyan-hamster-760485.hostingersite.com/wp-content/uploads/laila-avatar.webp",
  };

  var GREETING = [
    "Hey! I\u2019m **Laila**, your dive advisor at FlyingFish Scuba School \u2014 Goa\u2019s premier SSI-certified dive centre \uD83C\uDF0A",
    "",
    "I can help you with:",
    "- **Scuba diving packages** & prices",
    "- **SSI & PADI certification** courses",
    "- **Booking** your dive experience",
    "- Any questions about **diving in Goa**",
    "",
    "What brings you here today?",
  ].join("\n");

  var sid = null;
  try { sid = localStorage.getItem("ff_sid"); } catch(e){}
  var open = false, busy = false, qrDone = false;

  /* ── Markdown (robust, no lookbehind) ──────────── */
  function md(raw) {
    try {
      var t = raw
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      var lines = t.split("\n"), out = [], ul = false;

      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        var m;

        // headings
        m = ln.match(/^#{2,4}\s+(.+)/);
        if (m) { closeUl(); out.push("<h4>" + inline(m[1]) + "</h4>"); continue; }

        // unordered list: lines starting with - or * or bullet
        m = ln.match(/^\s*[-*\u2022]\s+(.+)/);
        if (m) {
          if (!ul) { out.push("<ul>"); ul = true; }
          out.push("<li>" + inline(m[1]) + "</li>");
          continue;
        }

        // numbered list
        m = ln.match(/^\s*(\d+)[.)]\s+(.+)/);
        if (m) { closeUl(); out.push("<p><strong>" + m[1] + ".</strong> " + inline(m[2]) + "</p>"); continue; }

        // hr
        closeUl();
        if (/^\s*-{3,}\s*$/.test(ln)) { out.push("<hr>"); continue; }

        // blank
        if (!ln.trim()) continue;

        // paragraph
        out.push("<p>" + inline(ln) + "</p>");
      }
      closeUl();
      return out.join("");

      function closeUl() { if (ul) { out.push("</ul>"); ul = false; } }
    } catch (e) {
      // Fallback: return escaped text with line breaks
      return raw.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>");
    }
  }

  function inline(t) {
    try {
      // Bold first (** **), then italic (* *)
      t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      // Italic: single * not preceded/followed by * — use word-boundary-safe approach
      t = t.replace(/(^|[^*])\*([^*]+?)\*([^*]|$)/g, "$1<em>$2</em>$3");
      // Inline code
      t = t.replace(/`(.+?)`/g, "<code>$1</code>");
      // Markdown links [text](url)
      t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      // WhatsApp number
      t = t.replace(/(\+91[\s-]?\d{5}[\s-]?\d{5})/g, '<a href="https://wa.me/919209247825" target="_blank" rel="noopener">$1</a>');
      return t;
    } catch (e) {
      return t;
    }
  }

  /* ── DOM ───────────────────────────────────────── */
  function build() {
    // Load fonts via <link> (more reliable than CSS @import)
    if (!document.querySelector('link[href*="Outfit"]')) {
      var fl = document.createElement("link");
      fl.rel = "stylesheet";
      fl.href = "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=DM+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap";
      document.head.appendChild(fl);
    }

    var w = document.createElement("div");
    w.id = "ff-chatbot";
    if (C.pos === "left") { w.style.right = "auto"; w.style.left = "24px"; }

    w.innerHTML =
      '<div class="ff-window" id="ff-w">' +
        /* header */
        '<div class="ff-header">' +
          '<div class="ff-header-avatar"><img src="'+C.avatar+'" alt="Laila"></div>' +
          '<div class="ff-header-info">' +
            '<div class="ff-header-name">Laila \u00b7 FlyingFish Scuba</div>' +
            '<div class="ff-header-status"><span class="ff-status-dot"></span>Online</div>' +
          '</div>' +
          '<button class="ff-header-close" id="ff-x" aria-label="Close">' +
            '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' +
          '</button>' +
        '</div>' +
        /* messages */
        '<div class="ff-messages" id="ff-m"></div>' +
        /* quick replies */
        '<div class="ff-quick-replies" id="ff-qr"></div>' +
        /* input */
        '<div class="ff-input-area">' +
          '<textarea class="ff-input" id="ff-i" placeholder="Type your message\u2026" rows="1"></textarea>' +
          '<button class="ff-send-btn" id="ff-s" aria-label="Send">' +
            '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="ff-powered">Powered by <a href="https://lightcyan-hamster-760485.hostingersite.com" target="_blank">FlyingFish Scuba School</a></div>' +
      '</div>' +
      /* toggle */
      '<button class="ff-toggle" id="ff-t" aria-label="Chat with us">' +
        '<svg class="ff-icon-chat" viewBox="0 0 24 24">' +
          '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/>' +
          '<path d="M7 9h10v2H7zm0-3h10v2H7zm0 6h7v2H7z"/>' +
        '</svg>' +
        '<svg class="ff-icon-close" viewBox="0 0 24 24">' +
          '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>' +
        '</svg>' +
        '<span class="ff-notif" id="ff-n">1</span>' +
      '</button>';

    document.body.appendChild(w);
  }

  /* ── Helpers ───────────────────────────────────── */
  function $(id) { return document.getElementById(id); }

  function scroll() {
    var m = $("ff-m");
    requestAnimationFrame(function() { m.scrollTop = m.scrollHeight; });
  }

  function addMsg(text, who) {
    var d = document.createElement("div");
    d.className = "ff-msg ff-msg-" + who;
    d.innerHTML = who === "bot" ? md(text) : escHtml(text);
    $("ff-m").appendChild(d);
    scroll();
  }

  function escHtml(t) {
    return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  function typing(on) {
    var e = $("ff-typ");
    if (!on) { if (e) e.remove(); return; }
    var d = document.createElement("div");
    d.className = "ff-typing"; d.id = "ff-typ";
    d.innerHTML = "<span></span><span></span><span></span>";
    $("ff-m").appendChild(d); scroll();
  }

  function showQR() {
    if (qrDone) return; qrDone = true;
    var qr = $("ff-qr");
    var items = [
      "Packages & prices",
      "I\u2019m a first-time diver!",
      "Certification courses",
      "Book a dive",
    ];
    qr.innerHTML = items.map(function(t) {
      return '<button class="ff-quick-btn">'+t+'</button>';
    }).join("");
    var btns = qr.querySelectorAll(".ff-quick-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function() {
        send(this.textContent);
        $("ff-qr").innerHTML = "";
      });
    }
  }

  /* ── API ───────────────────────────────────────── */
  function send(text) {
    if (busy || !text.trim()) return;
    $("ff-qr").innerHTML = "";
    addMsg(text.trim(), "user");
    $("ff-i").value = ""; $("ff-i").style.height = "auto";
    busy = true; $("ff-s").disabled = true;
    typing(true);

    fetch(C.api + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text.trim(), sessionId: sid }),
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      typing(false);
      if (d.reply) {
        sid = d.sessionId;
        try { localStorage.setItem("ff_sid", sid); } catch(e){}
        addMsg(d.reply, "bot");
      } else {
        addMsg(d.error || "Sorry, something went wrong. Please reach us on **WhatsApp at +91 92092 47825**!", "bot");
      }
    })
    .catch(function() {
      typing(false);
      addMsg("I\u2019m having trouble connecting right now. Please reach us on **WhatsApp at +91 92092 47825**!", "bot");
    })
    .finally(function() {
      busy = false; $("ff-s").disabled = false; $("ff-i").focus();
    });
  }

  /* ── Toggle ───────────────────────────────────── */
  function toggle() {
    open = !open;
    $("ff-w").classList.toggle("ff-visible", open);
    $("ff-t").classList.toggle("ff-open", open);
    if (open) {
      var n = $("ff-n"); if (n) n.style.display = "none";
      if (!$("ff-m").children.length) {
        addMsg(GREETING, "bot");
        setTimeout(showQR, 350);
      }
      $("ff-i").focus();
    }
  }

  /* ── Init ──────────────────────────────────────── */
  function init() {
    build();
    $("ff-t").addEventListener("click", toggle);
    $("ff-x").addEventListener("click", function(e) { e.stopPropagation(); if (open) toggle(); });
    $("ff-s").addEventListener("click", function() { send($("ff-i").value); });
    $("ff-i").addEventListener("keydown", function(e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(this.value); }
    });
    $("ff-i").addEventListener("input", function() {
      this.style.height = "auto";
      this.style.height = Math.min(this.scrollHeight, 100) + "px";
    });
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape" && open) toggle();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
