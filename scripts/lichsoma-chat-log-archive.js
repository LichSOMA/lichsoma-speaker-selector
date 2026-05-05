// LichSOMA Speaker Selector - Chat Log Archive
// 채팅 로그 HTML 파일을 열어서 확인하는 기능
(function() {
  'use strict';
  
  const MODULE_ID = 'lichsoma-speaker-selector';
  
  // 로그 폴더 경로 가져오기
  function getLogFolderPath() {
    const worldId = game.world.id;
    return `log-archive/${worldId}`;
  }
  
  // 로그 폴더 ID 가져오기
  function getLogFolderId() {
    return game.world.id;
  }
  
  // 디렉토리 존재 확인 및 생성 함수
  async function ensureDirectoryExists(FilePicker, targetPath, label = targetPath) {
    try {
      await FilePicker.browse('data', targetPath);
      return true;
    } catch (error) {
      // browse 실패 시 아래에서 디렉터리 생성 시도
    }

    if (typeof FilePicker.createDirectory === 'function') {
      try {
        await FilePicker.createDirectory('data', targetPath);
        return true;
      } catch (createError) {
        if (createError.message && createError.message.includes('EEXIST')) {
          return true;
        }
        console.warn(`[${MODULE_ID}] ${label} 생성 실패:`, createError);
      }
    } else {
      console.warn(`[${MODULE_ID}] ${label}를 자동으로 생성할 수 없습니다.`);
    }

    return false;
  }
  
  // 로그 폴더 존재 확인 함수
  async function ensureLogFolderExists() {
    // GM만 폴더 생성 가능
    if (!game.user?.isGM) {
      return;
    }
    
    try {
      const FilePicker = foundry.applications.apps.FilePicker.implementation;
      await ensureDirectoryExists(FilePicker, 'log-archive', 'log-archive 폴더');
      await ensureDirectoryExists(FilePicker, getLogFolderPath(), `월드 폴더(${getLogFolderId()})`);
    } catch (error) {
      console.warn(`[${MODULE_ID}] log-archive/월드 폴더 확인 중 오류:`, error);
    }
  }
  
  // 로그 폴더 생성 함수 (별칭)
  async function ensureLogFolder() {
    return await ensureLogFolderExists();
  }
  
  // 정렬 함수: 숫자 > 영어 > 한국어
  function sortItems(a, b) {
    const nameA = a.name || '';
    const nameB = b.name || '';
    
    // 첫 글자 확인
    const firstCharA = nameA.charAt(0);
    const firstCharB = nameB.charAt(0);
    
    // 숫자 체크
    const isNumberA = /[0-9]/.test(firstCharA);
    const isNumberB = /[0-9]/.test(firstCharB);
    
    // 영어 체크
    const isEnglishA = /[a-zA-Z]/.test(firstCharA);
    const isEnglishB = /[a-zA-Z]/.test(firstCharB);
    
    // 한국어 체크
    const isKoreanA = /[가-힣]/.test(firstCharA);
    const isKoreanB = /[가-힣]/.test(firstCharB);
    
    // 숫자 우선
    if (isNumberA && !isNumberB) return -1;
    if (!isNumberA && isNumberB) return 1;
    
    // 영어 다음
    if (!isNumberA && !isNumberB) {
      if (isEnglishA && !isEnglishB && !isKoreanB) return -1;
      if (!isEnglishA && !isKoreanA && isEnglishB) return 1;
    }
    
    // 한국어 다음
    if (!isNumberA && !isNumberB) {
      if (isKoreanA && !isKoreanB && !isEnglishB) return -1;
      if (!isKoreanA && isKoreanB) return 1;
    }
    
    // 같은 카테고리 내에서는 일반 정렬
    return nameA.localeCompare(nameB, 'ko', { numeric: true, sensitivity: 'base' });
  }
  
  // URL 디코딩 헬퍼 함수
  function decodeFileName(name) {
    try {
      // URL 인코딩된 문자열인지 확인 (%로 시작하는 패턴)
      if (name.includes('%')) {
        return decodeURIComponent(name);
      }
      return name;
    } catch (e) {
      // 디코딩 실패 시 원본 반환
      return name;
    }
  }
  
  // 폴더 내용 읽기
  async function browseFolder(folderPath) {
    try {
      const FilePicker = foundry.applications.apps.FilePicker.implementation;
      const result = await FilePicker.browse('data', folderPath);
      
      const folders = [];
      const files = [];
      
      // 폴더들 추가
      if (result.dirs) {
        for (const dir of result.dirs) {
          const decodedName = decodeFileName(dir);
          // 경로 구성: dir이 이미 folderPath를 포함하는지 확인
          let itemPath;
          if (dir.startsWith(folderPath)) {
            // dir이 이미 전체 경로를 포함하는 경우
            itemPath = dir;
          } else {
            // dir이 상대 경로인 경우
            itemPath = folderPath ? `${folderPath}/${dir}` : dir;
          }
          folders.push({
            name: decodedName,
            type: 'folder',
            path: itemPath  // path는 원본 유지 (파일 읽기용)
          });
        }
      }
      
      // 파일들 추가 (HTML만)
      if (result.files) {
        for (const file of result.files) {
          if (file.toLowerCase().endsWith('.html')) {
            const decodedName = decodeFileName(file);
            // 경로 구성: file이 이미 folderPath를 포함하는지 확인
            let itemPath;
            if (file.startsWith(folderPath)) {
              // file이 이미 전체 경로를 포함하는 경우
              itemPath = file;
            } else {
              // file이 상대 경로인 경우
              itemPath = folderPath ? `${folderPath}/${file}` : file;
            }
            files.push({
              name: decodedName,
              type: 'file',
              path: itemPath  // path는 원본 유지 (파일 읽기용)
            });
          }
        }
      }
      
      // 폴더와 파일을 각각 정렬
      folders.sort(sortItems);
      files.sort(sortItems);
      
      // 폴더를 먼저, 파일을 나중에 배치
      return [...folders, ...files];
    } catch (error) {
      console.warn(`[${MODULE_ID}] 폴더 읽기 실패:`, error);
      console.warn(`[${MODULE_ID}] 시도한 폴더 경로:`, folderPath);
      return [];
    }
  }
  
  // HTML 파일 읽기
  async function readHtmlFile(filePath) {
    try {
      // /data/ 없이 직접 경로 사용
      let url = filePath;
      
      // /로 시작하지 않으면 추가
      if (!url.startsWith('/')) {
        url = `/${url}`;
      }
      
      // 경로 세그먼트 연속 중복 제거
      const pathParts = url.split('/').filter(p => p);
      const cleanedParts = [];
      let lastPart = '';
      for (const part of pathParts) {
        if (part !== lastPart || cleanedParts.length === 0) {
          cleanedParts.push(part);
          lastPart = part;
        }
      }
      url = '/' + cleanedParts.join('/');
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      // 인코딩 문제 해결: ArrayBuffer로 읽어서 UTF-8로 디코딩
      const arrayBuffer = await response.arrayBuffer();
      const decoder = new TextDecoder('utf-8');
      let html = decoder.decode(arrayBuffer);
      
      // HTML에 charset 메타 태그가 없으면 추가
      if (!html.match(/<meta[^>]*charset/i)) {
        html = html.replace(
          /<head([^>]*)>/i,
          '<head$1><meta charset="UTF-8">'
        );
      }
      
      return html;
    } catch (error) {
      console.warn(`[${MODULE_ID}] HTML 파일 읽기 실패:`, error);
      console.warn(`[${MODULE_ID}] 시도한 경로:`, filePath);
      console.warn(`[${MODULE_ID}] 전체 URL:`, url);
      return null;
    }
  }
  
  // 경로에서 파일/폴더 이름만 추출
  function getDisplayName(item) {
    // item.name이 이미 파일/폴더 이름만 포함하고 있으면 그대로 사용
    // 혹시 경로를 포함하고 있다면 마지막 부분만 추출
    if (item.name.includes('/')) {
      return item.name.split('/').pop();
    }
    return item.name;
  }
  
  // 트리 아이템 렌더링
  function renderTreeItem(item, level = 0, expandedFolders = new Set()) {
    const isExpanded = expandedFolders.has(item.path);
    const indent = level * 20;
    const displayName = getDisplayName(item);
    
    if (item.type === 'folder') {
      return `
        <div class="lichsoma-archive-tree-item lichsoma-archive-folder" data-path="${item.path}" data-level="${level}" style="padding-left: ${indent}px;">
          <div class="lichsoma-archive-item-header">
            <i class="fas ${isExpanded ? 'fa-folder-open' : 'fa-folder'}" style="margin-right: 6px;"></i>
            <span class="lichsoma-archive-item-name">${displayName}</span>
          </div>
          <div class="lichsoma-archive-folder-content" style="display: ${isExpanded ? 'block' : 'none'};">
            <!-- 하위 항목이 여기에 동적으로 추가됩니다 -->
          </div>
        </div>
      `;
    } else {
      return `
        <div class="lichsoma-archive-tree-item lichsoma-archive-file" data-path="${item.path}" data-level="${level}" style="padding-left: ${indent}px;">
          <div class="lichsoma-archive-item-header">
            <i class="fas fa-file-code" style="margin-right: 6px;"></i>
            <span class="lichsoma-archive-item-name">${displayName}</span>
          </div>
        </div>
      `;
    }
  }
  
  // 트리 렌더링
  async function renderArchiveTree(container, folderPath = getLogFolderPath(), level = 0, expandedFolders = new Set()) {
    const items = await browseFolder(folderPath);
    
    if (items.length === 0) {
      if (level === 0) {
        container.innerHTML = `<div class="lichsoma-archive-empty">${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.NoFiles')}</div>`;
      }
      return;
    }
    
    let html = '';
    for (const item of items) {
      html += renderTreeItem(item, level, expandedFolders);
    }
    
    if (level === 0) {
      container.innerHTML = html;
      setupTreeEvents(container, expandedFolders);
    } else {
      return html;
    }
  }
  
  // 트리 이벤트 설정
  function setupTreeEvents(container, expandedFolders) {
    // 폴더 클릭 이벤트
    container.querySelectorAll('.lichsoma-archive-folder').forEach(folderEl => {
      const header = folderEl.querySelector('.lichsoma-archive-item-header');
      const content = folderEl.querySelector('.lichsoma-archive-folder-content');
      const path = folderEl.getAttribute('data-path');
      const level = parseInt(folderEl.getAttribute('data-level'));
      
      if (header && !header.dataset.listenerAdded) {
        header.dataset.listenerAdded = 'true';
        header.style.cursor = 'pointer';
        
        header.addEventListener('click', async (e) => {
          e.stopPropagation();
          
          const isExpanded = expandedFolders.has(path);
          const icon = header.querySelector('i');
          
          if (isExpanded) {
            // 접기
            expandedFolders.delete(path);
            content.style.display = 'none';
            icon.classList.remove('fa-folder-open');
            icon.classList.add('fa-folder');
          } else {
            // 펼치기
            expandedFolders.add(path);
            content.style.display = 'block';
            icon.classList.remove('fa-folder');
            icon.classList.add('fa-folder-open');
            
            // 하위 내용 로드
            if (content.children.length === 0) {
              content.innerHTML = `<div style="padding: 4px; color: var(--color-text-secondary);">${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.Loading')}</div>`;
              
              const subItems = await browseFolder(path);
              if (subItems.length > 0) {
                let subHtml = '';
                for (const item of subItems) {
                  subHtml += renderTreeItem(item, level + 1, expandedFolders);
                }
                content.innerHTML = subHtml;
                
                // 재귀적으로 이벤트 설정
                setupTreeEvents(content, expandedFolders);
              } else {
                content.innerHTML = `<div style="padding: 4px; color: var(--color-text-secondary);">${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.NoFiles')}</div>`;
              }
            }
          }
        });
      }
    });
    
    // 파일 클릭 이벤트
    container.querySelectorAll('.lichsoma-archive-file').forEach(fileEl => {
      const header = fileEl.querySelector('.lichsoma-archive-item-header');
      const path = fileEl.getAttribute('data-path');
      
      if (header && !header.dataset.listenerAdded) {
        header.dataset.listenerAdded = 'true';
        header.style.cursor = 'pointer';
        
        header.addEventListener('click', async (e) => {
          e.stopPropagation();
          
          // HTML 파일 읽기 및 표시
          const htmlContent = await readHtmlFile(path);
          if (htmlContent) {
            displayHtmlContent(htmlContent);
          } else {
            ui.notifications.error(game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.Error.LoadFailed'));
          }
        });
      }
    });
  }
  
  // HTML 내용 표시
  function displayHtmlContent(htmlContent) {
    // 기존 표시 영역이 있으면 제거
    const existingViewer = archiveWindow?.querySelector('.lichsoma-archive-html-viewer');
    if (existingViewer) {
      existingViewer.remove();
    }
    
    // 기존 트리 숨기기
    const tree = archiveWindow?.querySelector('.lichsoma-archive-tree');
    if (tree) {
      tree.style.display = 'none';
    }
    
    // 검색 바 숨기기
    const treeSearchBar = archiveWindow?.querySelector('.lichsoma-archive-search');
    if (treeSearchBar) {
      treeSearchBar.style.display = 'none';
    }
    
    // 아카이브 창 헤더에 뒤로 가기 버튼 추가
    const windowHeader = archiveWindow?.querySelector('.lichsoma-grid-window-header');
    const controls = windowHeader?.querySelector('.lichsoma-grid-controls');
    if (controls && !controls.querySelector('.lichsoma-archive-back-btn')) {
      const backBtn = document.createElement('button');
      backBtn.className = 'lichsoma-archive-back-btn';
      backBtn.title = game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.Back');
      backBtn.innerHTML = '<i class="fas fa-arrow-left"></i>';
      backBtn.addEventListener('click', () => {
        goBackToTree();
      });
      controls.insertBefore(backBtn, controls.firstChild);
    }
    
    // HTML에 스크롤바 스타일 및 검색 기능 추가
    const scrollbarStyle = `
      <style>
        * {
          scrollbar-width: thin;
          scrollbar-color: var(--color-dark-6, #4a4a4a) #1e1e1e;
        }
        *::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        *::-webkit-scrollbar-track {
          background: #1e1e1e;
        }
        *::-webkit-scrollbar-thumb {
          background-color: var(--color-dark-6, #4a4a4a);
          border-radius: 3px;
        }
        .lichsoma-search-highlight {
          background-color: rgba(255, 255, 0, 0.4);
          padding: 2px 0;
        }
        .lichsoma-search-highlight.active {
          background-color: rgba(255, 200, 0, 0.6);
        }
      </style>
    `;
    
    // 검색 기능 스크립트
    const searchScript = `
      <script>
        (function() {
          let searchQuery = '';
          let currentMatchIndex = -1;
          let matches = [];
          let originalTextNodes = new Map();
          
          // 하이라이트 제거 및 원본 텍스트 복원
          function removeHighlights() {
            document.querySelectorAll('.lichsoma-search-highlight').forEach(el => {
              const parent = el.parentNode;
              if (parent) {
                parent.replaceChild(document.createTextNode(el.textContent), el);
                parent.normalize();
              }
            });
            
            // 원본 텍스트 노드 복원
            originalTextNodes.forEach((originalText, node) => {
              if (node.parentNode && node.textContent !== originalText) {
                node.textContent = originalText;
              }
            });
            originalTextNodes.clear();
          }
          
          function findMatches(query) {
            // 먼저 모든 하이라이트 제거
            removeHighlights();
            
            if (!query) {
              matches = [];
              currentMatchIndex = -1;
              return;
            }
            
            const queryLower = query.toLowerCase();
            matches = [];
            
            // 원본 텍스트 노드 저장
            const walker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_TEXT,
              {
                acceptNode: function(node) {
                  // 스크립트와 스타일 태그 제외
                  const parent = node.parentElement;
                  if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) {
                    return NodeFilter.FILTER_REJECT;
                  }
                  return NodeFilter.FILTER_ACCEPT;
                }
              },
              false
            );
            
            let node;
            while (node = walker.nextNode()) {
              const originalText = node.textContent;
              originalTextNodes.set(node, originalText);
              
              const textLower = originalText.toLowerCase();
              let searchIndex = 0;
              
              // 모든 매치 찾기 (중복 포함)
              while ((searchIndex = textLower.indexOf(queryLower, searchIndex)) !== -1) {
                matches.push({
                  node: node,
                  index: searchIndex,
                  length: query.length,
                  text: originalText
                });
                searchIndex += query.length;
              }
            }
            
            // 하이라이트 적용 (역순으로 적용하여 인덱스 변경 방지)
            for (let i = matches.length - 1; i >= 0; i--) {
              const match = matches[i];
              const node = match.node;
              
              try {
                // 텍스트 노드 분할
                if (match.index > 0) {
                  node.splitText(match.index);
                }
                const matchNode = match.index === 0 ? node : node.nextSibling;
                if (matchNode && matchNode.nodeType === Node.TEXT_NODE) {
                  matchNode.splitText(match.length);
                  
                  const mark = document.createElement('mark');
                  mark.className = 'lichsoma-search-highlight' + (i === currentMatchIndex ? ' active' : '');
                  
                  const parent = matchNode.parentNode;
                  if (parent) {
                    parent.replaceChild(mark, matchNode);
                    mark.appendChild(matchNode);
                  }
                }
              } catch (e) {
                console.warn('하이라이트 적용 실패:', e);
              }
            }
          }
          
          function scrollToMatch(index) {
            if (matches.length === 0 || index < 0 || index >= matches.length) return;
            
            currentMatchIndex = index;
            
            // 모든 하이라이트 업데이트
            const highlights = document.querySelectorAll('.lichsoma-search-highlight');
            highlights.forEach((el, idx) => {
              el.classList.toggle('active', idx === index);
            });
            
            // 스크롤
            const mark = highlights[index];
            if (mark) {
              mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
          
          function search(query) {
            searchQuery = query;
            findMatches(query);
            if (matches.length > 0) {
              currentMatchIndex = 0;
              scrollToMatch(0);
            } else {
              currentMatchIndex = -1;
            }
          }
          
          function nextMatch() {
            if (matches.length === 0) return;
            currentMatchIndex = (currentMatchIndex + 1) % matches.length;
            scrollToMatch(currentMatchIndex);
          }
          
          function previousMatch() {
            if (matches.length === 0) return;
            currentMatchIndex = (currentMatchIndex - 1 + matches.length) % matches.length;
            scrollToMatch(currentMatchIndex);
          }
          
          function updateMatchCount() {
            return {
              count: matches.length,
              current: currentMatchIndex >= 0 ? currentMatchIndex + 1 : 0
            };
          }
          
          // 전역 함수로 노출
          window.lichsomaArchiveSearch = {
            search: search,
            next: nextMatch,
            previous: previousMatch,
            getMatchCount: () => matches.length,
            getCurrentIndex: () => currentMatchIndex,
            updateMatchCount: updateMatchCount
          };
        })();
      </script>
    `;
    
    // HTML에 스타일 및 스크립트 추가
    let styledHtml = htmlContent;
    if (styledHtml.includes('<head>')) {
      styledHtml = styledHtml.replace('<head>', `<head>${scrollbarStyle}${searchScript}`);
    } else if (styledHtml.includes('<head ')) {
      styledHtml = styledHtml.replace(/<head([^>]*)>/, `<head$1>${scrollbarStyle}${searchScript}`);
    } else {
      styledHtml = scrollbarStyle + searchScript + styledHtml;
    }
    
    // 새 표시 영역 생성 (헤더 없이)
    const viewer = document.createElement('div');
    viewer.className = 'lichsoma-archive-html-viewer';
    
    // 검색 바 생성
    const searchBar = document.createElement('div');
    searchBar.className = 'lichsoma-archive-log-search';
    searchBar.innerHTML = `
      <input type="text" class="lichsoma-archive-log-search-input" placeholder="${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.Search.PlaceholderInLog')}">
      <div class="lichsoma-archive-log-search-controls">
        <button class="lichsoma-archive-log-search-prev" title="${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.Search.Previous')}">
          <i class="fas fa-chevron-up"></i>
        </button>
        <span class="lichsoma-archive-log-search-count">0/0</span>
        <button class="lichsoma-archive-log-search-next" title="${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.Search.Next')}">
          <i class="fas fa-chevron-down"></i>
        </button>
      </div>
    `;
    
    // 콘텐츠 영역 생성
    const contentDiv = document.createElement('div');
    contentDiv.className = 'lichsoma-archive-viewer-content';
    
    // iframe 생성 및 HTML 내용 설정
    const iframe = document.createElement('iframe');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    
    // srcdoc에 직접 설정
    iframe.srcdoc = styledHtml;
    
    // iframe 로드 후 검색 기능 연결
    iframe.addEventListener('load', () => {
      const searchInput = searchBar.querySelector('.lichsoma-archive-log-search-input');
      const searchPrev = searchBar.querySelector('.lichsoma-archive-log-search-prev');
      const searchNext = searchBar.querySelector('.lichsoma-archive-log-search-next');
      const searchCount = searchBar.querySelector('.lichsoma-archive-log-search-count');
      
      const updateSearch = () => {
        try {
          const iframeWindow = iframe.contentWindow;
          if (iframeWindow && iframeWindow.lichsomaArchiveSearch) {
            const query = searchInput.value.trim();
            iframeWindow.lichsomaArchiveSearch.search(query);
            updateMatchCount();
          }
        } catch (e) {
          // 크로스 오리진 오류 무시
        }
      };
      
      const updateMatchCount = () => {
        try {
          const iframeWindow = iframe.contentWindow;
          if (iframeWindow && iframeWindow.lichsomaArchiveSearch) {
            const count = iframeWindow.lichsomaArchiveSearch.getMatchCount();
            const current = iframeWindow.lichsomaArchiveSearch.getCurrentIndex();
            searchCount.textContent = count > 0 ? `${current + 1}/${count}` : '0/0';
          }
        } catch (e) {
          // 크로스 오리진 오류 무시
        }
      };
      
      if (searchInput) {
        let searchTimeout = null;
        let isComposing = false;
        
        // 한글 입력 처리
        searchInput.addEventListener('compositionstart', () => {
          isComposing = true;
          clearTimeout(searchTimeout);
        });
        
        searchInput.addEventListener('compositionend', () => {
          isComposing = false;
          clearTimeout(searchTimeout);
          searchTimeout = setTimeout(() => {
            updateSearch();
          }, 100);
        });
        
        searchInput.addEventListener('input', (e) => {
          if (isComposing) return;
          
          clearTimeout(searchTimeout);
          searchTimeout = setTimeout(() => {
            updateSearch();
          }, 300);
        });
        
        searchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const iframeWindow = iframe.contentWindow;
            if (iframeWindow && iframeWindow.lichsomaArchiveSearch) {
              if (e.ctrlKey || e.metaKey) {
                iframeWindow.lichsomaArchiveSearch.previous();
              } else {
                iframeWindow.lichsomaArchiveSearch.next();
              }
              updateMatchCount();
            }
          }
        });
      }
      
      if (searchPrev) {
        searchPrev.addEventListener('click', () => {
          const iframeWindow = iframe.contentWindow;
          if (iframeWindow && iframeWindow.lichsomaArchiveSearch) {
            iframeWindow.lichsomaArchiveSearch.previous();
            updateMatchCount();
          }
        });
      }
      
      if (searchNext) {
        searchNext.addEventListener('click', () => {
          const iframeWindow = iframe.contentWindow;
          if (iframeWindow && iframeWindow.lichsomaArchiveSearch) {
            iframeWindow.lichsomaArchiveSearch.next();
            updateMatchCount();
          }
        });
      }
    });
    
    contentDiv.appendChild(iframe);
    viewer.appendChild(searchBar);
    viewer.appendChild(contentDiv);
    
    // 아카이브 창에 추가
    const content = archiveWindow?.querySelector('.lichsoma-archive-content');
    if (content) {
      content.appendChild(viewer);
    }
  }
  
  // 트리로 돌아가기
  function goBackToTree() {
    // HTML 뷰어 제거
    const viewer = archiveWindow?.querySelector('.lichsoma-archive-html-viewer');
    if (viewer) {
      viewer.remove();
    }
    
    // 트리 다시 표시
    const tree = archiveWindow?.querySelector('.lichsoma-archive-tree');
    if (tree) {
      tree.style.display = 'block';
    }
    
    // 검색 바 다시 표시
    const treeSearchBar = archiveWindow?.querySelector('.lichsoma-archive-search');
    if (treeSearchBar) {
      treeSearchBar.style.display = 'flex';
    }
    
    // 뒤로 가기 버튼 제거
    const backBtn = archiveWindow?.querySelector('.lichsoma-archive-back-btn');
    if (backBtn) {
      backBtn.remove();
    }
  }
  
  // 아카이브 창 인스턴스 저장
  let archiveWindow = null;
  let expandedFolders = new Set();
  
  // 아카이브 창 생성
  async function createArchiveWindow() {
    // 이미 창이 있으면 닫기
    if (archiveWindow) {
      closeArchiveWindow();
      return;
    }
    
    // 메인 컨테이너 생성
    archiveWindow = document.createElement('div');
    archiveWindow.className = 'lichsoma-chat-log-archive-window';
    archiveWindow.innerHTML = `
      <div class="lichsoma-grid-window-header" style="cursor: move;">
        <h3>${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.Title')}</h3>
        <div class="lichsoma-grid-controls">
          <button class="lichsoma-archive-close-btn" title="${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.Close')}"><i class="fas fa-x"></i></button>
        </div>
      </div>
      <div class="lichsoma-grid-window-content">
        <div class="lichsoma-archive-content">
          <div class="lichsoma-archive-search">
            <input type="text" class="lichsoma-archive-search-input" placeholder="${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.Search.Placeholder')}">
          </div>
          <div class="lichsoma-archive-tree">
            <div style="padding: 8px; color: var(--color-text-secondary);">${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.Loading')}</div>
          </div>
        </div>
      </div>
    `;
    
    // body에 추가
    document.body.appendChild(archiveWindow);
    
    // 이벤트 리스너 추가
    setupArchiveWindowEvents();
    setupSearchEvents();
    
    // 애니메이션을 위한 클래스 추가
    setTimeout(() => {
      archiveWindow.classList.add('lichsoma-grid-window-open');
    }, 10);
    
    // 트리 렌더링
    const treeContainer = archiveWindow.querySelector('.lichsoma-archive-tree');
    if (treeContainer) {
      await renderArchiveTree(treeContainer, getLogFolderPath(), 0, expandedFolders);
    }
  }
  
  // 검색 이벤트 설정
  function setupSearchEvents() {
    if (!archiveWindow) return;
    
    const searchInput = archiveWindow.querySelector('.lichsoma-archive-search-input');
    
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        filterTreeItems(query);
      });
    }
  }
  
  // 접혀있는 폴더 펼치기 (재귀적)
  async function expandAllFolders(container, expandedFolders) {
    let hasNewFolders = true;
    let iterations = 0;
    const maxIterations = 100; // 무한 루프 방지
    
    // 모든 폴더가 펼쳐질 때까지 반복
    while (hasNewFolders && iterations < maxIterations) {
      iterations++;
      hasNewFolders = false;
      const folders = container.querySelectorAll('.lichsoma-archive-folder');
      
      for (const folderEl of folders) {
        const header = folderEl.querySelector('.lichsoma-archive-item-header');
        const content = folderEl.querySelector('.lichsoma-archive-folder-content');
        const path = folderEl.getAttribute('data-path');
        const level = parseInt(folderEl.getAttribute('data-level'));
        
        if (!header || !content || !path) continue;
        
        // 이미 펼쳐져 있으면 하위 항목이 로드되었는지 확인
        if (expandedFolders.has(path)) {
          // 하위 항목이 로드되지 않았으면 로드
          const hasLoadedContent = content.querySelector('.lichsoma-archive-tree-item') !== null || 
                                   content.textContent.includes('NoFiles') ||
                                   content.textContent.includes('파일이 없습니다');
          
          if (!hasLoadedContent) {
            content.innerHTML = `<div style="padding: 4px; color: var(--color-text-secondary);">${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.Loading')}</div>`;
            
            const subItems = await browseFolder(path);
            if (subItems.length > 0) {
              let subHtml = '';
              for (const item of subItems) {
                subHtml += renderTreeItem(item, level + 1, expandedFolders);
              }
              content.innerHTML = subHtml;
              setupTreeEvents(content, expandedFolders);
            } else {
              content.innerHTML = `<div style="padding: 4px; color: var(--color-text-secondary);">${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.NoFiles')}</div>`;
            }
          }
          
          // 하위 폴더도 재귀적으로 펼치기
          await expandAllFolders(content, expandedFolders);
          continue;
        }
        
        // 폴더 펼치기
        hasNewFolders = true;
        expandedFolders.add(path);
        content.style.display = 'block';
        const icon = header.querySelector('i');
        if (icon) {
          icon.classList.remove('fa-folder');
          icon.classList.add('fa-folder-open');
        }
        
        // 하위 내용 로드 (항상 로드 확인)
        const hasContent = content.querySelector('.lichsoma-archive-tree-item') !== null || 
                          content.textContent.includes('NoFiles') || 
                          content.textContent.includes('로딩');
        
        if (!hasContent || content.querySelector('.lichsoma-archive-tree-item') === null) {
          content.innerHTML = `<div style="padding: 4px; color: var(--color-text-secondary);">${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.Loading')}</div>`;
          
          const subItems = await browseFolder(path);
          if (subItems.length > 0) {
            let subHtml = '';
            for (const item of subItems) {
              subHtml += renderTreeItem(item, level + 1, expandedFolders);
            }
            content.innerHTML = subHtml;
            
            // 재귀적으로 이벤트 설정
            setupTreeEvents(content, expandedFolders);
          } else {
            content.innerHTML = `<div style="padding: 4px; color: var(--color-text-secondary);">${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.NoFiles')}</div>`;
          }
        }
        
        // 하위 폴더도 재귀적으로 펼치기
        await expandAllFolders(content, expandedFolders);
      }
      
      // DOM 업데이트 대기
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  
  // 모든 파일/폴더를 재귀적으로 수집 (speaker-selecter 방식 참고)
  async function collectAllItems(folderPath = getLogFolderPath(), parentPath = '') {
    const items = await browseFolder(folderPath);
    const result = [];
    
    for (const item of items) {
      const fullPath = parentPath ? `${parentPath}/${item.name}` : item.name;
      const itemWithParent = { ...item, fullPath, parentPath };
      
      if (item.type === 'folder') {
        // 폴더의 하위 항목도 재귀적으로 수집
        const subItems = await collectAllItems(item.path, fullPath);
        itemWithParent.children = subItems;
        result.push(itemWithParent);
      } else {
        result.push(itemWithParent);
      }
    }
    
    return result;
  }
  
  // 검색어로 필터링 (일치하는 항목이 있는 폴더만 포함)
  function filterItems(items, query) {
    if (!query) return items;
    
    const queryLower = query.toLowerCase();
    const filtered = [];
    
    for (const item of items) {
      if (item.type === 'file') {
        // 파일 이름으로 검색
        const name = getDisplayName(item).toLowerCase();
        if (name.includes(queryLower)) {
          filtered.push(item);
        }
      } else if (item.type === 'folder') {
        // 폴더의 하위 항목도 재귀적으로 필터링
        const filteredChildren = filterItems(item.children || [], query);
        
        // 폴더 이름으로 검색하거나, 하위 항목 중 일치하는 것이 있으면 포함
        const folderName = getDisplayName(item).toLowerCase();
        const hasMatchingChild = filteredChildren.length > 0;
        const folderMatches = folderName.includes(queryLower);
        
        if (folderMatches || hasMatchingChild) {
          const filteredItem = { ...item };
          filteredItem.children = filteredChildren;
          filtered.push(filteredItem);
        }
      }
    }
    
    return filtered;
  }
  
  // 필터링된 트리 렌더링 (폴더는 항상 펼쳐진 상태)
  function renderFilteredTree(items, level = 0) {
    let html = '';
    
    for (const item of items) {
      const indent = level * 20;
      const displayName = getDisplayName(item);
      
      if (item.type === 'folder') {
        html += `
          <div class="lichsoma-archive-tree-item lichsoma-archive-folder" data-path="${item.path}" data-level="${level}" style="padding-left: ${indent}px;">
            <div class="lichsoma-archive-item-header">
              <i class="fas fa-folder-open" style="margin-right: 6px;"></i>
              <span class="lichsoma-archive-item-name">${displayName}</span>
            </div>
            <div class="lichsoma-archive-folder-content" style="display: block;">
              ${renderFilteredTree(item.children || [], level + 1)}
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="lichsoma-archive-tree-item lichsoma-archive-file" data-path="${item.path}" data-level="${level}" style="padding-left: ${indent}px;">
            <div class="lichsoma-archive-item-header">
              <i class="fas fa-file-code" style="margin-right: 6px;"></i>
              <span class="lichsoma-archive-item-name">${displayName}</span>
            </div>
          </div>
        `;
      }
    }
    
    return html;
  }
  
  // 트리 아이템 필터링 (speaker-selecter 방식 참고)
  async function filterTreeItems(query) {
    const tree = archiveWindow?.querySelector('.lichsoma-archive-tree');
    if (!tree) return;
    
    if (!query) {
      // 검색어가 없으면 원래 트리로 복원
      await renderArchiveTree(tree);
      const emptyMsg = tree.querySelector('.lichsoma-archive-search-empty');
      if (emptyMsg) {
        emptyMsg.remove();
      }
      return;
    }
    
    // 로딩 표시
    tree.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--color-text-secondary);">${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.Loading')}</div>`;
    
    try {
      // 모든 항목 수집
      const allItems = await collectAllItems();
      
      // 검색어로 필터링
      const filteredItems = filterItems(allItems, query);
      
      // 필터링된 트리 렌더링
      if (filteredItems.length === 0) {
        tree.innerHTML = `<div class="lichsoma-archive-search-empty">${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.Search.NoResults')}</div>`;
      } else {
        const html = renderFilteredTree(filteredItems);
        tree.innerHTML = html;
        
        // 이벤트 설정 (검색 결과에서도 클릭 가능하도록)
        setupTreeEvents(tree, expandedFolders);
      }
    } catch (error) {
      console.error(`[${MODULE_ID}] 검색 중 오류:`, error);
      tree.innerHTML = `<div class="lichsoma-archive-search-empty">${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.Error.LoadFailed')}</div>`;
    }
  }
  
  // 아카이브 창 닫기
  function closeArchiveWindow() {
    if (archiveWindow) {
      archiveWindow.classList.remove('lichsoma-grid-window-open');
      setTimeout(() => {
        archiveWindow.remove();
        archiveWindow = null;
        expandedFolders.clear();
      }, 200);
    }
  }
  
  // 아카이브 창 이벤트 설정
  function setupArchiveWindowEvents() {
    if (!archiveWindow) return;
    
    // 창 드래그 기능
    const header = archiveWindow.querySelector('.lichsoma-grid-window-header');
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };
    let animationFrameId = null;

    const handleMouseDown = (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
        return;
      }
      
      isDragging = true;
      const rect = archiveWindow.getBoundingClientRect();
      archiveWindow.style.left = rect.left + 'px';
      archiveWindow.style.top = rect.top + 'px';
      archiveWindow.style.transform = 'none';
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;
      
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      e.preventDefault();
    };

    const handleMouseMove = (e) => {
      if (!isDragging) return;
      
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      
      animationFrameId = requestAnimationFrame(() => {
        const x = e.clientX - dragOffset.x;
        const y = e.clientY - dragOffset.y;
        const maxX = window.innerWidth - archiveWindow.offsetWidth;
        const maxY = window.innerHeight;
        const clampedX = Math.max(0, Math.min(x, maxX));
        const clampedY = Math.max(0, Math.min(y, maxY));
        archiveWindow.style.left = clampedX + 'px';
        archiveWindow.style.top = clampedY + 'px';
      });
    };

    const handleMouseUp = () => {
      isDragging = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    if (header) {
      header.addEventListener('mousedown', handleMouseDown);
    }
    
    // 닫기 버튼
    const closeBtn = archiveWindow.querySelector('.lichsoma-archive-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => closeArchiveWindow());
    }
    
    // ESC 키로 닫기
    const handleKeydown = (e) => {
      if (e.key === 'Escape' && archiveWindow) {
        closeArchiveWindow();
        document.removeEventListener('keydown', handleKeydown);
      }
    };
    document.addEventListener('keydown', handleKeydown);
  }
  
  // 아카이브 패널 열기 함수
  function openChatLogArchive() {
    createArchiveWindow();
  }

  // 설정 사이드바에 버튼 추가 함수
  function addArchiveButtonToSettings() {
    // 설정 사이드바 찾기
    const settingsSidebar = document.querySelector('section#settings.sidebar-tab');
    if (!settingsSidebar) {
      return false;
    }

    // 이미 버튼이 추가되어 있으면 중복 추가 방지
    if (settingsSidebar.querySelector('.lichsoma-chat-log-archive-btn')) {
      return true;
    }

    // 게임 설정 섹션 찾기
    const settingsSection = settingsSidebar.querySelector('section.settings');
    if (!settingsSection) {
      return false;
    }

    // 아카이브 섹션 생성
    const archiveSection = document.createElement('section');
    archiveSection.className = 'archive flexcol';
    archiveSection.innerHTML = `
      <h4 class="divider">${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.Title')}</h4>
      <button type="button" class="lichsoma-chat-log-archive-btn">
        <i class="fa-solid fa-box-archive" inert=""></i> ${game.i18n.localize('SPEAKERSELECTOR.ChatLogArchive.Button.OpenArchive')}
      </button>
    `;

    // 게임 설정 섹션 다음에 삽입 (도움말 및 문서 섹션 앞)
    const documentationSection = settingsSidebar.querySelector('section.documentation');
    if (documentationSection) {
      documentationSection.before(archiveSection);
    } else {
      // 도움말 섹션이 없으면 settings 섹션 다음에 추가
      settingsSection.after(archiveSection);
    }

    // 버튼 클릭 이벤트
    const button = archiveSection.querySelector('.lichsoma-chat-log-archive-btn');
    if (button) {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        openChatLogArchive();
      });
    }

    return true;
  }

  // 설정 사이드바 렌더링 시 버튼 추가
  Hooks.on('renderSidebarTab', (app, html, data) => {
    if (app.tabName === 'settings') {
      // DOM이 완전히 준비될 때까지 약간의 딜레이
      setTimeout(() => {
        addArchiveButtonToSettings();
      }, 100);
    }
  });

  // 모듈 초기화 완료 시
  Hooks.once('ready', () => {
    // 로그 폴더 생성 확인
    ensureLogFolderExists();
    
    // 설정 사이드바가 이미 열려있는 경우를 대비해 버튼 추가 시도
    setTimeout(() => {
      addArchiveButtonToSettings();
    }, 500);
  });
})();
