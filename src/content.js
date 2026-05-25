(function () {
  'use strict';

  const HOST_ID = 'translate-extension-host';

  const STYLES = `
:host {
  all: initial;
}

@keyframes popup-in {
  from {
    opacity: 0;
    transform: translateY(-8px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.translate-popup {
  position: fixed;
  z-index: 2147483647;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  padding: 16px;
  max-width: 420px;
  min-width: 240px;
  max-height: 60vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: #333;
  animation: popup-in 0.2s ease-out;
}

.popup-header {
  border-bottom: 1px solid #f0f0f0;
  padding-bottom: 10px;
  margin-bottom: 10px;
}

.popup-word {
  font-size: 20px;
  font-weight: 600;
  color: #1a1a1a;
  margin: 0 0 4px 0;
}

.popup-phonetic {
  font-size: 13px;
  color: #666;
}

.phonetic-label {
  color: #999;
  margin-right: 2px;
}

.phonetic-value {
  margin-right: 12px;
}

.meaning-section {
  margin-bottom: 12px;
}

.pos-tag {
  display: inline-block;
  background: #e3f2fd;
  color: #1565c0;
  font-size: 12px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 4px;
  margin-bottom: 6px;
}

.definition-list {
  margin: 0;
  padding-left: 18px;
  color: #333;
}

.definition-list li {
  margin-bottom: 4px;
}

.example-block {
  margin: 6px 0 6px 18px;
  padding: 8px 10px;
  background: #f8f9fa;
  border-left: 3px solid #4CAF50;
  border-radius: 0 6px 6px 0;
}

.example-en {
  color: #2e7d32;
  font-style: italic;
  margin: 0 0 2px 0;
}

.example-zh {
  color: #555;
  margin: 0;
}

.extra-section {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #f0f0f0;
}

.extra-row {
  margin-bottom: 4px;
  font-size: 13px;
}

.extra-label {
  color: #999;
  margin-right: 4px;
  font-weight: 500;
}

.extra-value {
  color: #555;
}

.sentence-original {
  color: #666;
  font-size: 13px;
  margin: 0 0 8px 0;
  padding: 8px;
  background: #f8f9fa;
  border-radius: 6px;
}

.sentence-translation {
  color: #1a1a1a;
  font-size: 15px;
  margin: 0;
  font-weight: 500;
}

.error-message {
  color: #e53935;
  text-align: center;
  padding: 12px 0;
}

.retry-btn {
  display: block;
  margin: 8px auto 0;
  padding: 6px 16px;
  background: #e53935;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.retry-btn:hover {
  background: #c62828;
}

.loading-spinner {
  text-align: center;
  padding: 20px 0;
  color: #999;
  font-size: 13px;
}

.spinner {
  display: inline-block;
  width: 24px;
  height: 24px;
  border: 3px solid #e0e0e0;
  border-top-color: #4CAF50;
  border-radius: 50%;
  margin-bottom: 8px;
  animation: spin 0.8s linear infinite;
}

.close-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  cursor: pointer;
  color: #999;
  font-size: 16px;
  line-height: 1;
  border-radius: 4px;
}

.close-btn:hover {
  color: #333;
  background: #f0f0f0;
}
`;

  let enabled = true;
  let retryContext = null;
  let popupHost = null;

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function isPureChinese(text) {
    return !/[a-zA-Z]/.test(text);
  }

  function removePopup() {
    if (popupHost) {
      popupHost.remove();
      popupHost = null;
      retryContext = null;
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', onMouseDown, true);
    }
  }

  function repositionPopup() {
    if (!popupHost || !popupHost.shadowRoot) return;
    const popup = popupHost.shadowRoot.querySelector('.translate-popup');
    if (!popup) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const rect = selection.getRangeAt(selection.rangeCount - 1).getBoundingClientRect();
    if (!rect) return;

    const popupWidth = popup.offsetWidth;
    const popupHeight = popup.offsetHeight;
    const viewWidth = window.innerWidth;
    const viewHeight = window.innerHeight;

    let left = rect.left + rect.width / 2 - popupWidth / 2;
    left = Math.max(8, Math.min(left, viewWidth - popupWidth - 8));

    const spaceBelow = viewHeight - rect.bottom;
    const spaceAbove = rect.top;
    let top;
    if (spaceBelow >= popupHeight + 10 || spaceBelow >= spaceAbove) {
      top = rect.bottom + 8;
    } else {
      top = rect.top - popupHeight - 8;
    }
    top = Math.max(8, Math.min(top, viewHeight - popupHeight - 8));

    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
  }

  function createPopup() {
    removePopup();

    popupHost = document.createElement('div');
    popupHost.id = HOST_ID;

    const shadow = popupHost.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = STYLES;
    shadow.appendChild(styleEl);

    const popup = document.createElement('div');
    popup.className = 'translate-popup';
    shadow.appendChild(popup);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', removePopup);
    popup.appendChild(closeBtn);

    document.body.appendChild(popupHost);

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onMouseDown, true);

    return { shadow, popup };
  }

  function clearContent(popup) {
    while (popup.children.length > 1) {
      popup.removeChild(popup.lastChild);
    }
  }

  function renderLoading(shadow, popup) {
    clearContent(popup);
    const div = document.createElement('div');
    div.className = 'loading-spinner';
    div.innerHTML = '<div class="spinner"></div><div>翻译中...</div>';
    popup.appendChild(div);
  }

  function renderError(shadow, popup, message) {
    clearContent(popup);
    const div = document.createElement('div');
    div.innerHTML =
      '<div class="error-message">' + escapeHtml(message) + '</div>' +
      '<button class="retry-btn">重试</button>';
    popup.appendChild(div);

    const retryBtn = div.querySelector('.retry-btn');
    retryBtn.addEventListener('click', function () {
      if (retryContext) {
        doTranslate(retryContext.text, retryContext.mode);
      }
    });
  }

  function renderWordResult(shadow, popup, data) {
    clearContent(popup);

    if (data.raw) {
      const div = document.createElement('div');
      div.innerHTML =
        '<p class="popup-word">' + escapeHtml(data.word || '') + '</p>' +
        '<p>' + escapeHtml(data.raw) + '</p>';
      popup.appendChild(div);
      return;
    }

    let html = '';
    html += '<div class="popup-header">';
    html += '<p class="popup-word">' + escapeHtml(data.word || '') + '</p>';
    if (data.phonetic && (data.phonetic.uk || data.phonetic.us)) {
      html += '<div class="popup-phonetic">';
      if (data.phonetic.uk) {
        html += '<span class="phonetic-label">英</span><span class="phonetic-value">/' + escapeHtml(data.phonetic.uk) + '/</span>';
      }
      if (data.phonetic.us) {
        html += '<span class="phonetic-label">美</span><span class="phonetic-value">/' + escapeHtml(data.phonetic.us) + '/</span>';
      }
      html += '</div>';
    }
    html += '</div>';

    if (data.meanings && data.meanings.length > 0) {
      for (var mi = 0; mi < data.meanings.length; mi++) {
        var meaning = data.meanings[mi];
        html += '<div class="meaning-section">';
        if (meaning.pos) {
          html += '<span class="pos-tag">' + escapeHtml(meaning.pos) + '</span>';
        }
        if (meaning.definitions && meaning.definitions.length > 0) {
          html += '<ul class="definition-list">';
          for (var di = 0; di < meaning.definitions.length; di++) {
            html += '<li>' + escapeHtml(meaning.definitions[di]) + '</li>';
          }
          html += '</ul>';
        }
        if (meaning.examples && meaning.examples.length > 0) {
          for (var ei = 0; ei < meaning.examples.length; ei++) {
            var ex = meaning.examples[ei];
            html += '<div class="example-block">';
            html += '<p class="example-en">' + escapeHtml(ex.en) + '</p>';
            html += '<p class="example-zh">' + escapeHtml(ex.zh) + '</p>';
            html += '</div>';
          }
        }
        html += '</div>';
      }
    }

    if (data.synonyms || data.antonyms || data.collocations || data.etymology) {
      html += '<div class="extra-section">';
      if (data.synonyms && data.synonyms.length > 0) {
        html += '<div class="extra-row"><span class="extra-label">近义词</span><span class="extra-value">' + escapeHtml(data.synonyms.join(', ')) + '</span></div>';
      }
      if (data.antonyms && data.antonyms.length > 0) {
        html += '<div class="extra-row"><span class="extra-label">反义词</span><span class="extra-value">' + escapeHtml(data.antonyms.join(', ')) + '</span></div>';
      }
      if (data.collocations && data.collocations.length > 0) {
        html += '<div class="extra-row"><span class="extra-label">搭配</span><span class="extra-value">' + escapeHtml(data.collocations.join(', ')) + '</span></div>';
      }
      if (data.etymology) {
        html += '<div class="extra-row"><span class="extra-label">词源</span><span class="extra-value">' + escapeHtml(data.etymology) + '</span></div>';
      }
      html += '</div>';
    }

    var contentDiv = document.createElement('div');
    contentDiv.innerHTML = html;
    popup.appendChild(contentDiv);
  }

  function renderSentenceResult(shadow, popup, data) {
    clearContent(popup);
    var div = document.createElement('div');
    div.innerHTML =
      '<p class="sentence-original">' + escapeHtml(data.original) + '</p>' +
      '<p class="sentence-translation">' + escapeHtml(data.translation) + '</p>';
    popup.appendChild(div);
  }

  function doTranslate(text, mode) {
    retryContext = { text: text, mode: mode };

    var created = createPopup();
    renderLoading(created.shadow, created.popup);
    repositionPopup();

    chrome.runtime.sendMessage(
      { type: 'translate', text: text, mode: mode },
      function (response) {
        if (!popupHost) return;

        if (chrome.runtime.lastError) {
          renderError(created.shadow, created.popup, chrome.runtime.lastError.message);
          repositionPopup();
          return;
        }

        if (!response) {
          renderError(created.shadow, created.popup, '未收到回复');
          repositionPopup();
          return;
        }

        if (response.type === 'error') {
          renderError(created.shadow, created.popup, response.message);
          repositionPopup();
          return;
        }

        if (response.type === 'word') {
          renderWordResult(created.shadow, created.popup, response);
        } else if (response.type === 'sentence') {
          renderSentenceResult(created.shadow, created.popup, response);
        }
        repositionPopup();
      }
    );
  }

  function handleMouseUp(e) {
    if (!enabled) return;
    if (e.target.closest('#' + HOST_ID)) return;

    var selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    var text = selection.toString().trim();
    if (!text || text.length > 500) return;
    if (isPureChinese(text)) return;

    var mode = /\s/.test(text) ? 'sentence' : 'word';
    doTranslate(text, mode);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      removePopup();
    }
  }

  function onMouseDown(e) {
    if (!e.target.closest('#' + HOST_ID)) {
      removePopup();
      window.getSelection().removeAllRanges();
    }
  }

  function onMessage(request, sender, sendResponse) {
    if (request.type === 'toggle') {
      enabled = request.enabled;
    }
  }

  chrome.storage.sync.get(['enabled'], function (result) {
    if (result.enabled !== undefined) {
      enabled = result.enabled;
    }
  });

  chrome.runtime.onMessage.addListener(onMessage);
  document.addEventListener('mouseup', handleMouseUp);
})();
