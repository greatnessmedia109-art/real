(function () {
  'use strict';

  // ---------- tiny helpers ----------
  function h(tag, props) {
    var e = document.createElement(tag);
    var p = props || {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in e) e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    var kids = Array.prototype.slice.call(arguments, 2);
    (function add(list) {
      list.forEach(function (kid) {
        if (kid == null || kid === false) return;
        if (Array.isArray(kid)) return add(kid);
        e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
      });
    })(kids);
    return e;
  }

  var app = document.getElementById('app');
  var toasts = document.getElementById('toasts');
  var state = { user: null, setup: {}, dirty: false, hash: '', previewImages: {}, hadSession: false, reverting: false };

  function toast(msg, bad) {
    var t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
    toasts.append(t);
    setTimeout(function () { t.remove(); }, bad ? 7000 : 4500);
  }

  function SignedOut() { this.message = 'signed-out'; }
  function fail(e) {
    if (e instanceof SignedOut) return;
    toast(e && e.message ? e.message : 'Something went wrong.', true);
  }

  function api(method, path, body) {
    return fetch('/api/' + path, {
      method: method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && path !== 'login') {
          state.user = null;
          renderLogin(state.hadSession ? 'Your session ended. Sign in again.' : '');
          throw new SignedOut();
        }
        if (!res.ok) throw new Error(data.error || 'The request failed (' + res.status + ').');
        return data;
      });
    });
  }

  function slugify(s) {
    return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/g, '');
  }
  var todayStr = function () {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso.length > 10 ? iso : iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function fmtDateTime(iso) {
    return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // ---------- sign in ----------
  function renderLogin(message) {
    state.dirty = false;
    var err = h('p', { class: 'err', role: 'alert' }, message || '');
    var user = h('input', { type: 'text', name: 'username', autocomplete: 'username', required: true, autocapitalize: 'none', spellcheck: false });
    var pass = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
    var btn = h('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
    var form = h('form', {
      onsubmit: function (ev) {
        ev.preventDefault();
        btn.disabled = true;
        err.textContent = '';
        api('POST', 'login', { username: user.value, password: pass.value })
          .then(function () { return boot(); })
          .catch(function (e) { err.textContent = e.message; btn.disabled = false; pass.value = ''; pass.focus(); });
      },
    },
      h('div', null, h('h1', null, 'Sign in'), h('p', null, 'Use the username and password you were given.')),
      h('label', { class: 'f' }, 'Username', user),
      h('label', { class: 'f' }, 'Password', pass),
      err, btn);
    app.replaceChildren(h('div', { class: 'login' }, form));
    user.focus();
  }

  // ---------- shell ----------
  function shell(active, content) {
    var tabs = [['posts', 'Posts'], ['leads', 'Leads']];
    if (state.user.role === 'owner') tabs.push(['settings', 'Settings'], ['team', 'Team']);
    var banner = null;
    if (!state.setup.github) {
      banner = h('div', { class: 'notice' }, h('strong', null, 'GitHub is not connected yet. '), 'Posts cannot be saved until GITHUB_REPO and GITHUB_TOKEN are added in Netlify. The setup guide (README) explains how.');
    }
    app.replaceChildren(
      h('header', { class: 'bar' }, h('div', { class: 'bar-in' },
        h('strong', null, 'Admin'),
        h('nav', { class: 'tabs', 'aria-label': 'Sections' }, tabs.map(function (t) {
          return h('a', { href: '#/' + t[0], 'aria-current': active === t[0] ? 'page' : null }, t[1]);
        })),
        h('div', { class: 'who' },
          h('a', { href: '/', target: '_blank', rel: 'noopener' }, 'View site'),
          h('span', null, state.user.username),
          h('button', { class: 'btn small', type: 'button', onclick: signOut }, 'Sign out')))),
      h('main', null, banner, content));
    window.scrollTo(0, 0);
  }

  function signOut() {
    if (state.dirty && !confirm('You have unsaved changes. Sign out anyway?')) return;
    state.dirty = false;
    api('POST', 'logout', {}).finally(function () { state.user = null; location.hash = ''; renderLogin(''); });
  }

  // ---------- posts list ----------
  function viewPosts() {
    var holder = h('div', null, h('p', { class: 'muted' }, 'Loading posts…'));
    shell('posts', [
      h('div', { class: 'head' }, h('h1', null, 'Posts'), h('a', { class: 'btn primary', href: '#/posts/new' }, 'New post')),
      holder,
    ]);
    api('GET', 'posts').then(function (data) {
      var posts = data.posts;
      if (!posts.length) {
        holder.replaceChildren(h('div', { class: 'box empty' }, h('h2', null, 'No posts yet'), h('p', { class: 'muted' }, 'Write your first post. It goes live on your site about a minute after you publish it.'), h('a', { class: 'btn primary', href: '#/posts/new' }, 'Write a post')));
        return;
      }
      var search = h('input', { type: 'search', placeholder: 'Search posts', 'aria-label': 'Search posts', oninput: draw });
      var list = h('ul', { class: 'list' });
      function draw() {
        var q = search.value.trim().toLowerCase();
        var shown = posts.filter(function (p) { return !q || (p.title + ' ' + p.tags.join(' ')).toLowerCase().indexOf(q) >= 0; });
        list.replaceChildren.apply(list, shown.length ? shown.map(row) : [h('li', null, h('span', { class: 'muted' }, 'No posts match that search.'))]);
      }
      function row(p) {
        return h('li', null,
          h('div', null,
            h('a', { class: 'title', href: '#/posts/edit/' + p.slug }, p.title || p.slug),
            h('div', { class: 'meta' }, h('span', { class: 'badge ' + (p.draft ? 'draft' : 'live') }, p.draft ? 'Draft' : 'Published'), h('span', null, fmtDate(p.date)), p.tags.length ? h('span', null, p.tags.join(', ')) : null)),
          h('div', { class: 'row' },
            p.draft ? null : h('a', { class: 'btn small', href: '/blog/' + p.slug + '/', target: '_blank', rel: 'noopener' }, 'View'),
            h('a', { class: 'btn small', href: '#/posts/edit/' + p.slug }, 'Edit')));
      }
      holder.replaceChildren(h('div', { class: 'stack' }, h('div', { style: 'max-width:22rem' }, search), list));
      draw();
    }).catch(function (e) { fail(e); holder.replaceChildren(h('p', { class: 'err' }, e.message)); });
  }

  // ---------- editor ----------
  var previewCss = null;
  function loadPreviewCss() {
    if (previewCss) return Promise.resolve(previewCss);
    return fetch('/assets/manifest.json').then(function (r) { return r.json(); }).then(function (m) { return fetch(m.css); }).then(function (r) { return r.text(); }).then(function (css) { previewCss = css; return css; }).catch(function () { return ''; });
  }
  var escHtml = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  if (window.marked && window.marked.use) window.marked.use({ renderer: { html: function (t) { return escHtml(t.text || t); } } });

  function renderPreview(md) {
    var html = window.marked ? window.marked.parse(md || '') : '<p>Preview is unavailable.</p>';
    Object.keys(state.previewImages).forEach(function (url) { html = html.split(url).join(state.previewImages[url]); });
    html = html.replace(/(src=")\/(?!\/)/g, '$1' + location.origin + '/');
    return loadPreviewCss().then(function (css) {
      return '<!doctype html><html><head><meta charset="utf-8"><style>' + css + ' body{padding:1.5rem}</style></head><body><div class="prose">' + html + '</div></body></html>';
    });
  }

  function readAsBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('Could not read that file.')); };
      r.readAsDataURL(blob);
    });
  }

  function prepareImage(file) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return Promise.reject(new Error('Choose a JPG, PNG, WebP or GIF image.'));
    if (file.type === 'image/gif') {
      return file.size > 3000000 ? Promise.reject(new Error('GIFs must be under 3 MB.')) : Promise.resolve({ blob: file, type: file.type });
    }
    return createImageBitmap(file).then(function (bmp) {
      var scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      var c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise(function (resolve) {
        c.toBlob(function (webp) {
          if (webp && webp.type === 'image/webp') return resolve({ blob: webp, type: 'image/webp' });
          c.toBlob(function (jpg) { resolve({ blob: jpg, type: 'image/jpeg' }); }, 'image/jpeg', 0.86);
        }, 'image/webp', 0.86);
      });
    });
  }

  function uploadImage(file) {
    return prepareImage(file).then(function (img) {
      if (img.blob.size > 3400000) throw new Error('That image is still over 3.4 MB after resizing. Use a smaller one.');
      return readAsBase64(img.blob).then(function (dataUrl) {
        return api('POST', 'upload', { name: file.name, type: img.type, data: dataUrl.split(',')[1] }).then(function (res) {
          state.previewImages[res.url] = dataUrl;
          return res.url;
        });
      });
    });
  }

  function viewEditor(slug) {
    var isNew = !slug;
    var load = isNew
      ? Promise.resolve({ title: '', description: '', date: todayStr(), tags: [], cover: '', coverAlt: '', draft: true, body: '', slug: '' })
      : api('GET', 'posts/' + encodeURIComponent(slug)).then(function (d) { return d.post; });
    shell('posts', h('p', { class: 'muted' }, 'Loading…'));
    load.then(function (post) { buildEditor(post, isNew); }).catch(function (e) {
      fail(e);
      shell('posts', [h('p', { class: 'err' }, e.message), h('a', { href: '#/posts' }, 'Back to posts')]);
    });
  }

  function buildEditor(post, isNew) {
    var f = { title: post.title, description: post.description, date: post.date || todayStr(), tags: post.tags.join(', '), cover: post.cover, coverAlt: post.coverAlt, body: post.body, slug: post.slug };
    var slugTouched = !isNew;
    state.dirty = false;
    var markDirty = function () { state.dirty = true; };

    var title = h('input', { type: 'text', class: 'title-in', placeholder: 'Post title', value: f.title, maxLength: 160, 'aria-label': 'Post title', oninput: function () {
      f.title = title.value; markDirty();
      if (!slugTouched) { f.slug = slugify(f.title); if (slugInput) slugInput.value = f.slug; }
      drawSnippet();
    } });
    var body = h('textarea', { class: 'body-in', value: f.body, 'aria-label': 'Post content', placeholder: 'Write in Markdown. Use ## for headings.', oninput: function () { f.body = body.value; markDirty(); drawStats(); } });
    var stats = h('div', { class: 'stats' });
    var preview = h('iframe', { class: 'preview', sandbox: '', title: 'Preview', hidden: true });
    var mode = 'write';
    var writeBtn = h('button', { type: 'button', 'aria-pressed': 'true', onclick: function () { setMode('write'); } }, 'Write');
    var prevBtn = h('button', { type: 'button', 'aria-pressed': 'false', onclick: function () { setMode('preview'); } }, 'Preview');
    function setMode(m) {
      mode = m;
      writeBtn.setAttribute('aria-pressed', m === 'write');
      prevBtn.setAttribute('aria-pressed', m === 'preview');
      body.hidden = m !== 'write';
      preview.hidden = m !== 'preview';
      toolbarTools.hidden = m !== 'write';
      if (m === 'preview') renderPreview(f.body).then(function (doc) { preview.srcdoc = doc; });
    }
    function drawStats() {
      var words = (f.body.trim().match(/\S+/g) || []).length;
      stats.textContent = words + ' words, about ' + Math.max(1, Math.round(words / 220)) + ' min read';
    }
    function wrap(before, after, placeholder) {
      var s = body.selectionStart, e = body.selectionEnd, sel = body.value.slice(s, e) || placeholder;
      body.setRangeText(before + sel + after, s, e, 'select');
      body.setSelectionRange(s + before.length, s + before.length + sel.length);
      body.focus(); f.body = body.value; markDirty(); drawStats();
    }
    function linePrefix(prefix) {
      var s = body.selectionStart, e = body.selectionEnd, v = body.value;
      var start = v.lastIndexOf('\n', s - 1) + 1;
      var block = v.slice(start, e).split('\n').map(function (l, i) { return prefix.replace('#', i + 1) + l; }).join('\n');
      body.setRangeText(block, start, e, 'end');
      body.focus(); f.body = body.value; markDirty(); drawStats();
    }
    function insertText(text) {
      var s = body.selectionStart;
      body.setRangeText(text, s, body.selectionEnd, 'end');
      body.focus(); f.body = body.value; markDirty(); drawStats();
    }
    var fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true, onchange: function () {
      var file = fileInput.files[0]; fileInput.value = '';
      if (!file) return;
      toast('Uploading image…');
      uploadImage(file).then(function (url) {
        insertText('\n![Describe the image](' + url + ')\n');
        toast('Image added. Replace "Describe the image" with a short description.');
      }).catch(fail);
    } });
    function tb(label, title, fn) { return h('button', { type: 'button', title: title, 'aria-label': title, onclick: fn }, label); }
    var toolbarTools = h('div', { class: 'row', style: 'gap:.15rem' },
      tb('H2', 'Heading', function () { linePrefix('## '); }),
      tb('H3', 'Subheading', function () { linePrefix('### '); }),
      tb('B', 'Bold', function () { wrap('**', '**', 'bold text'); }),
      tb('I', 'Italic', function () { wrap('*', '*', 'italic text'); }),
      tb('Link', 'Add link', function () {
        var url = prompt('Link address (https://…)');
        if (url) wrap('[', '](' + url + ')', 'link text');
      }),
      tb('• List', 'Bulleted list', function () { linePrefix('- '); }),
      tb('1. List', 'Numbered list', function () { linePrefix('#. '); }),
      tb('Quote', 'Quote', function () { linePrefix('> '); }),
      tb('Image', 'Upload and insert image', function () { fileInput.click(); }));
    var toolbar = h('div', { class: 'toolbar' }, toolbarTools, h('span', { class: 'sp' }), h('span', { class: 'seg row', style: 'gap:.15rem' }, writeBtn, prevBtn));

    // sidebar
    var slugInput = null;
    var slugField;
    if (isNew) {
      slugInput = h('input', { type: 'text', value: f.slug, maxLength: 80, 'aria-label': 'Web address', oninput: function () { slugTouched = true; f.slug = slugify(slugInput.value); markDirty(); drawSnippet(); } });
      slugField = h('label', { class: 'f' }, 'Web address', h('div', { class: 'slugline' }, h('span', null, '/blog/'), slugInput), h('span', { class: 'hint' }, 'Set once, then it cannot change. Short and descriptive works best.'));
    } else {
      slugField = h('div', { class: 'f' }, 'Web address', h('div', { class: 'muted' }, '/blog/' + f.slug + '/'));
    }
    var desc = h('textarea', { rows: 3, maxLength: 300, value: f.description, oninput: function () { f.description = desc.value; markDirty(); drawSnippet(); } });
    var descCount = h('span', { class: 'count' });
    var titleCount = h('span', { class: 'count' });
    var snippet = h('div', { class: 'snippet', 'aria-label': 'How this appears in Google' });
    function drawSnippet() {
      var t = f.title || 'Post title';
      titleCount.textContent = t.length + '/60';
      titleCount.className = 'count' + (t.length > 60 ? ' over' : '');
      descCount.textContent = f.description.length + '/160';
      descCount.className = 'count' + (f.description.length > 160 ? ' over' : '');
      snippet.replaceChildren(
        h('div', { class: 'u' }, location.host + ' › blog › ' + (f.slug || '…')),
        h('div', { class: 't' }, t.length > 60 ? t.slice(0, 57) + '…' : t),
        h('div', { class: 'd' }, f.description ? (f.description.length > 160 ? f.description.slice(0, 157) + '…' : f.description) : 'Add a description. It appears under the title in search results.'));
    }
    var tags = h('input', { type: 'text', value: f.tags, placeholder: 'SEO, Tips', oninput: function () { f.tags = tags.value; markDirty(); } });
    var date = h('input', { type: 'date', value: f.date, oninput: function () { f.date = date.value; markDirty(); } });

    var coverImg = h('img', { class: 'cover-prev', alt: '', hidden: !f.cover, src: f.cover || null });
    var coverAlt = h('input', { type: 'text', value: f.coverAlt, maxLength: 200, placeholder: 'Describe the image', oninput: function () { f.coverAlt = coverAlt.value; markDirty(); } });
    var coverFile = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true, onchange: function () {
      var file = coverFile.files[0]; coverFile.value = '';
      if (!file) return;
      toast('Uploading image…');
      uploadImage(file).then(function (url) {
        f.cover = url; markDirty();
        coverImg.src = state.previewImages[url]; coverImg.hidden = false; removeCover.hidden = false;
        toast('Cover image added.');
      }).catch(fail);
    } });
    var removeCover = h('button', { class: 'btn small', type: 'button', hidden: !f.cover, onclick: function () { f.cover = ''; coverImg.hidden = true; removeCover.hidden = true; markDirty(); } }, 'Remove');

    var saving = false;
    function save(draft) {
      if (saving) return;
      if (!f.title.trim()) { toast('Add a title before saving.', true); title.focus(); return; }
      if (!f.slug) { toast('Add a web address before saving.', true); if (slugInput) slugInput.focus(); return; }
      saving = true;
      buttons.forEach(function (b) { b.disabled = true; });
      api('PUT', 'posts/' + encodeURIComponent(f.slug), {
        isNew: isNew, title: f.title, description: f.description, date: f.date,
        tags: f.tags.split(',').map(function (t) { return t.trim(); }).filter(Boolean),
        cover: f.cover, coverAlt: f.coverAlt, draft: draft, body: f.body,
      }).then(function () {
        state.dirty = false;
        toast(draft ? 'Draft saved.' : 'Published. It goes live in about a minute.');
        location.hash = '#/posts/edit/' + f.slug;
        if (!isNew) viewEditor(f.slug);
      }).catch(fail).finally(function () { saving = false; buttons.forEach(function (b) { b.disabled = false; }); });
    }
    var publishLabel = post.draft ? 'Publish' : 'Update post';
    var publishBtn = h('button', { class: 'btn primary', type: 'button', onclick: function () { save(false); } }, isNew ? 'Publish' : publishLabel);
    var draftBtn = h('button', { class: 'btn', type: 'button', onclick: function () { save(true); } }, !isNew && !post.draft ? 'Unpublish (save as draft)' : 'Save draft');
    var buttons = [publishBtn, draftBtn];
    var del = isNew ? null : h('button', { class: 'btn danger', type: 'button', onclick: function () {
      if (!confirm('Delete "' + (f.title || f.slug) + '"? It is removed from your site. This cannot be undone from the admin panel.')) return;
      api('DELETE', 'posts/' + encodeURIComponent(f.slug)).then(function () { state.dirty = false; toast('Post deleted.'); location.hash = '#/posts'; }).catch(fail);
    } }, 'Delete post');

    shell('posts', [
      h('div', { class: 'head' }, h('a', { href: '#/posts' }, 'All posts'),
        h('span', { class: 'badge ' + (isNew || post.draft ? 'draft' : 'live') }, isNew || post.draft ? 'Draft' : 'Published')),
      h('div', { class: 'ed' },
        h('div', { class: 'stack' }, title, h('div', null, toolbar, body, preview, stats), fileInput),
        h('aside', { class: 'side' },
          h('div', { class: 'box stack' }, h('h2', null, 'Publish'), h('div', { class: 'stack' }, publishBtn, draftBtn),
            h('label', { class: 'f' }, 'Publish date', date), del),
          h('div', { class: 'box stack' }, h('h2', null, 'Search appearance'), slugField,
            h('div', { class: 'f' }, h('span', null, 'Search title ', titleCount), h('span', { class: 'hint' }, 'Taken from the post title. Aim for under 60 characters.')),
            h('label', { class: 'f' }, h('span', null, 'Description ', descCount), desc),
            snippet),
          h('div', { class: 'box stack' }, h('h2', null, 'Details'),
            h('label', { class: 'f' }, 'Tags', tags, h('span', { class: 'hint' }, 'Separate with commas.')),
            h('div', { class: 'f' }, 'Cover image', coverImg, h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: function () { coverFile.click(); } }, 'Upload image'), removeCover), coverFile),
            h('label', { class: 'f' }, 'Cover image description', coverAlt)))),
    ]);
    drawSnippet(); drawStats();
    if (!isNew) document.title = 'Edit: ' + f.title;
    document.onkeydown = function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') { ev.preventDefault(); save(isNew ? true : post.draft); }
    };
  }

  // ---------- leads ----------
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function viewLeads() {
    var holder = h('p', { class: 'muted' }, 'Loading leads…');
    var all = [];
    var total = 0;
    shell('leads', [h('div', { class: 'head' }, h('h1', null, 'Leads')), holder]);
    function load(offset) {
      return api('GET', 'leads?offset=' + offset + '&limit=100').then(function (d) { total = d.total; all = all.concat(d.items); draw(); });
    }
    function exportCsv() {
      var cols = ['Date', 'Name', 'Email', 'Phone', 'Message', 'Post', 'Status', 'Note', 'Source'];
      var rows = all.map(function (l) {
        return [l.createdAt, l.name, l.email, l.phone, l.message, l.postTitle, l.status, l.note, [l.utm && l.utm.utm_source, l.utm && l.utm.utm_medium, l.utm && l.utm.utm_campaign].filter(Boolean).join(' / ')].map(csvCell).join(',');
      });
      var blob = new Blob([cols.map(csvCell).join(',') + '\n' + rows.join('\n')], { type: 'text/csv' });
      var a = h('a', { href: URL.createObjectURL(blob), download: 'leads-' + todayStr() + '.csv' });
      document.body.append(a); a.click(); a.remove();
    }
    function card(l) {
      var status = h('select', { 'aria-label': 'Status for ' + l.name, onchange: function () {
        api('PATCH', 'leads/' + encodeURIComponent(l.id), { status: status.value }).then(function (r) { l.status = r.lead.status; badge.className = 'badge ' + l.status; badge.textContent = l.status; toast('Status updated.'); }).catch(fail);
      } }, ['new', 'contacted', 'won', 'lost'].map(function (s) { return h('option', { value: s, selected: l.status === s }, s); }));
      var badge = h('span', { class: 'badge ' + l.status }, l.status);
      var note = h('input', { type: 'text', placeholder: 'Add a note', value: l.note || '', maxLength: 1000, 'aria-label': 'Note for ' + l.name, onchange: function () {
        api('PATCH', 'leads/' + encodeURIComponent(l.id), { note: note.value }).then(function () { l.note = note.value; toast('Note saved.'); }).catch(fail);
      } });
      var src = [l.utm && l.utm.utm_source, l.utm && l.utm.utm_medium, l.utm && l.utm.utm_campaign].filter(Boolean).join(' / ');
      return h('li', { class: 'lead-item' },
        h('div', { class: 'lead-top' }, h('strong', null, l.name, ' ', badge), h('span', { class: 'muted small' }, fmtDateTime(l.createdAt))),
        h('div', { class: 'small' }, h('a', { href: 'mailto:' + l.email }, l.email), l.phone ? [' · ', h('a', { href: 'tel:' + l.phone.replace(/[^0-9+]/g, '') }, l.phone)] : null),
        l.message ? h('p', { class: 'lead-msg' }, l.message) : null,
        h('div', { class: 'muted small' }, l.postTitle ? 'From: ' + l.postTitle : 'Direct', src ? ' · ' + src : ''),
        h('div', { class: 'lead-acts' }, status, note, h('button', { class: 'btn small danger', type: 'button', onclick: function () {
          if (!confirm('Delete the lead from ' + l.name + '? This cannot be undone.')) return;
          api('DELETE', 'leads/' + encodeURIComponent(l.id)).then(function () { all = all.filter(function (x) { return x.id !== l.id; }); total--; draw(); toast('Lead deleted.'); }).catch(fail);
        } }, 'Delete')));
    }
    function draw() {
      if (!all.length) {
        holder.replaceChildren(h('div', { class: 'box empty' }, h('h2', null, 'No leads yet'), h('p', { class: 'muted' }, 'When someone fills in the form under a post, they show up here.')));
        return;
      }
      var fresh = all.filter(function (l) { return l.status === 'new'; }).length;
      holder.replaceChildren(h('div', { class: 'stack' },
        !state.setup.email && state.user.role === 'owner' ? h('div', { class: 'notice' }, h('strong', null, 'Email alerts are off. '), 'Add RESEND_API_KEY and LEAD_NOTIFY_EMAIL in Netlify to get an email for each new lead.') : null,
        h('div', { class: 'row' }, h('span', { class: 'muted' }, total + ' lead' + (total === 1 ? '' : 's') + ', ' + fresh + ' new'), h('button', { class: 'btn small', type: 'button', onclick: exportCsv }, 'Download CSV')),
        h('ul', { class: 'list' }, all.map(card)),
        all.length < total ? h('button', { class: 'btn', type: 'button', onclick: function () { load(all.length).catch(fail); } }, 'Load older leads') : null));
    }
    load(0).catch(function (e) { fail(e); holder.replaceChildren(h('p', { class: 'err' }, e.message)); });
  }

  // ---------- settings (owner) ----------
  function viewSettings() {
    shell('settings', [h('div', { class: 'head' }, h('h1', null, 'Settings')), h('p', { class: 'muted' }, 'Loading…')]);
    api('GET', 'settings').then(function (d) {
      var s = d.settings; var l = s.lead || {};
      var fields = {};
      function text(key, label, value, opts) {
        opts = opts || {};
        var el = opts.area ? h('textarea', { rows: 2, value: value || '', maxLength: opts.max || 300 }) : h('input', { type: 'text', value: value || '', maxLength: opts.max || 200, placeholder: opts.ph || null });
        fields[key] = el;
        return h('label', { class: 'f' }, label, el, opts.hint ? h('span', { class: 'hint' }, opts.hint) : null);
      }
      function check(key, label, value) {
        var el = h('input', { type: 'checkbox', checked: !!value });
        fields[key] = el;
        return h('label', { class: 'row' }, el, label);
      }
      var accent = h('input', { type: 'color', value: s.accent || '#0e7c66', 'aria-label': 'Accent colour', style: 'width:3rem;height:2.5rem;padding:0' });
      var save = h('button', { class: 'btn primary', type: 'submit' }, 'Save settings');
      var form = h('form', { class: 'stack', style: 'max-width:40rem', onsubmit: function (ev) {
        ev.preventDefault();
        save.disabled = true;
        api('PUT', 'settings', {
          name: fields.name.value, tagline: fields.tagline.value, description: fields.description.value, url: fields.url.value, author: fields.author.value,
          accent: accent.value, postsPerPage: s.postsPerPage, footer: fields.footer.value,
          lead: { heading: fields.heading.value, text: fields.text.value, button: fields.button.value, askPhone: fields.askPhone.checked, askMessage: fields.askMessage.checked, consent: fields.consent.value, thankYou: fields.thankYou.value },
        }).then(function () { toast('Settings saved. The site updates in about a minute.'); }).catch(fail).finally(function () { save.disabled = false; });
      } },
        h('div', { class: 'box stack' }, h('h2', null, 'Site'),
          text('name', 'Site name', s.name, { max: 80 }),
          text('tagline', 'Home page headline', s.tagline, { max: 120 }),
          text('description', 'Site description', s.description, { area: true, hint: 'Used in search results for your home page.' }),
          text('url', 'Site address', s.url, { ph: 'https://www.example.com', hint: 'Your main web address, starting with https://. Used for search engine links.' }),
          text('author', 'Author name', s.author, { max: 80 }),
          text('footer', 'Footer text', s.footer, { hint: '{year} becomes the current year.' }),
          h('label', { class: 'f' }, 'Accent colour', accent)),
        h('div', { class: 'box stack' }, h('h2', null, 'Lead form under each post'),
          text('heading', 'Heading', l.heading, { max: 120 }),
          text('text', 'Text under the heading', l.text, { area: true }),
          text('button', 'Button label', l.button, { max: 40 }),
          check('askPhone', 'Ask for a phone number', l.askPhone),
          check('askMessage', 'Ask for a message', l.askMessage),
          text('consent', 'Consent checkbox wording', l.consent, { hint: 'Leave empty to hide the checkbox.' }),
          text('thankYou', 'Message after sending', l.thankYou)),
        h('div', null, save));
      shell('settings', [h('div', { class: 'head' }, h('h1', null, 'Settings')), form]);
    }).catch(function (e) { fail(e); shell('settings', [h('div', { class: 'head' }, h('h1', null, 'Settings')), h('p', { class: 'err' }, e.message)]); });
  }

  // ---------- team (owner) ----------
  function viewTeam() {
    var holder = h('p', { class: 'muted' }, 'Loading…');
    shell('team', [
      h('div', { class: 'head' }, h('h1', null, 'Team')),
      h('p', { class: 'muted' }, 'Editors can write and publish posts and see leads. Only you can change settings and manage the team.'),
      holder,
    ]);
    function load() {
      return api('GET', 'users').then(function (d) {
        var uname = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: false, required: true });
        var pw = h('input', { type: 'text', autocomplete: 'off', required: true, minLength: 10 });
        var add = h('button', { class: 'btn primary', type: 'submit' }, 'Add editor');
        var form = h('form', { class: 'box stack', style: 'max-width:28rem', onsubmit: function (ev) {
          ev.preventDefault();
          add.disabled = true;
          api('POST', 'users', { username: uname.value, password: pw.value }).then(function () { toast('Editor added. Send them the username and password.'); return load(); }).catch(fail).finally(function () { add.disabled = false; });
        } },
          h('h2', null, 'Add an editor'),
          h('label', { class: 'f' }, 'Username', uname, h('span', { class: 'hint' }, '3 to 40 letters, numbers, dots, hyphens or underscores.')),
          h('label', { class: 'f' }, 'Password', pw, h('span', { class: 'hint' }, 'At least 10 characters. Share it with them privately.')),
          add);
        var list = h('ul', { class: 'list' },
          h('li', null, h('div', null, h('strong', null, d.owner), h('div', { class: 'meta' }, 'Owner (you). Change this password in Netlify.')), h('span', null)),
          d.users.map(function (u) {
            return h('li', null, h('div', null, h('strong', null, u.username), h('div', { class: 'meta' }, 'Editor, added ' + fmtDate(u.createdAt))),
              h('div', { class: 'row' },
                h('button', { class: 'btn small', type: 'button', onclick: function () {
                  var p = prompt('New password for ' + u.username + ' (at least 10 characters)');
                  if (!p) return;
                  api('PUT', 'users/' + encodeURIComponent(u.username), { password: p }).then(function () { toast('Password changed.'); }).catch(fail);
                } }, 'Reset password'),
                h('button', { class: 'btn small danger', type: 'button', onclick: function () {
                  if (!confirm('Remove ' + u.username + '? They are signed out straight away.')) return;
                  api('DELETE', 'users/' + encodeURIComponent(u.username)).then(function () { toast('Editor removed.'); return load(); }).catch(fail);
                } }, 'Remove')));
          }));
        holder.replaceChildren(h('div', { class: 'stack' }, list, form));
      }).catch(function (e) { fail(e); holder.replaceChildren(h('p', { class: 'err' }, e.message)); });
    }
    load();
  }

  // ---------- routing ----------
  function route() {
    document.onkeydown = null;
    document.title = 'Admin';
    if (!state.user) return;
    var parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    var a = parts[0] || 'posts';
    if (a === 'posts' && parts[1] === 'new') return viewEditor(null);
    if (a === 'posts' && parts[1] === 'edit' && parts[2]) return viewEditor(parts[2]);
    if (a === 'leads') return viewLeads();
    if (a === 'settings' && state.user.role === 'owner') return viewSettings();
    if (a === 'team' && state.user.role === 'owner') return viewTeam();
    return viewPosts();
  }

  window.addEventListener('hashchange', function () {
    if (state.reverting) { state.reverting = false; return; }
    if (state.dirty && state.hash !== location.hash) {
      if (!confirm('You have unsaved changes. Leave without saving?')) { state.reverting = true; location.hash = state.hash; return; }
      state.dirty = false;
    }
    state.hash = location.hash;
    route();
  });
  window.addEventListener('beforeunload', function (ev) { if (state.dirty) { ev.preventDefault(); ev.returnValue = ''; } });

  function boot() {
    return api('GET', 'me').then(function (me) {
      state.user = me.user; state.setup = me.setup; state.hash = location.hash; state.hadSession = true;
      route();
    }).catch(function (e) { if (!(e instanceof SignedOut)) renderLogin(''); });
  }
  boot();
})();
