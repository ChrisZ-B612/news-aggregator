/**
 *
 * Copyright 2015 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
APP.Main = (function() {

  var LAZY_LOAD_THRESHOLD = 300;
  var BATCH_SIZE = 30;
  var MAX_STORY_REQUESTS = 6;
  var COMMENT_BATCH_SIZE = 12;
  var COMMENT_LOAD_THRESHOLD = 500;

  var $ = document.querySelector.bind(document);
  var main = $('main');
  var header = $('header');
  var headerTitles = header.querySelector('.header__title-wrapper');

  var stories = null;
  var storyStart = 0;
  var storyBatchLoading = false;
  var activeStoryRequests = 0;
  var storyRequestQueue = [];
  var inDetails = false;
  var scrollUpdateScheduled = false;
  var visualUpdateScheduled = false;
  var relativeTimeFormatter = typeof Intl !== 'undefined' &&
      Intl.RelativeTimeFormat ?
      new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' }) :
      null;

  function escapeHTML(value) {
    if (value === null || typeof value === 'undefined')
      return '';

    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
  }

  function escapeAttribute(value) {
    return escapeHTML(value).replace(/`/g, '&#96;');
  }

  function formatRelative(time) {
    if (!time)
      return '';

    var diff = time - Date.now();
    var absDiff = Math.abs(diff);
    var divisions = [
      { amount: 60 * 1000, name: 'second' },
      { amount: 60 * 60 * 1000, name: 'minute' },
      { amount: 24 * 60 * 60 * 1000, name: 'hour' },
      { amount: 30 * 24 * 60 * 60 * 1000, name: 'day' },
      { amount: 365 * 24 * 60 * 60 * 1000, name: 'month' },
      { amount: Infinity, name: 'year' }
    ];
    var previousAmount = 1000;

    for (var i = 0; i < divisions.length; i++) {
      if (absDiff < divisions[i].amount) {
        var value = Math.round(diff / previousAmount);

        if (relativeTimeFormatter)
          return relativeTimeFormatter.format(value, divisions[i].name);

        value = Math.abs(value);
        return value + ' ' + divisions[i].name +
            (value === 1 ? '' : 's') + (diff < 0 ? ' ago' : '');
      }

      previousAmount = divisions[i].amount;
    }

    return '';
  }

  function storyTemplate(details) {
    var relativeTime = details.time ? ', ' + formatRelative(details.time) : '';

    return '<h1 class="story__title">' + escapeHTML(details.title) + '</h1>' +
        '<div class="story__score">' + escapeHTML(details.score) + '</div>' +
        '<div class="story__by">Posted by ' + escapeHTML(details.by) +
        relativeTime + '</div>';
  }

  function storyDetailsTemplate(details) {
    var hostname = '';
    var externalLink = '';
    var visitLink = '';
    var relativeTime = details.time ? ', ' + formatRelative(details.time) : '';

    if (details.urlobj) {
      hostname = ' <a class="story-details__title-link" href="' +
          escapeAttribute(details.url) + '">(' +
          escapeHTML(details.urlobj.hostname) + ')</a>';
      visitLink = '<div><a class="story-details__link" href="' +
          escapeAttribute(details.url) + '">Visit site</a></div>';
    }

    if (details.kids && details.kids.length) {
      externalLink = '<section class="story-details__comments js-comments">' +
          '<h2 class="story-details__comments-title">Comments</h2>' +
          '</section>';
    }

    return '<header class="story-details__header js-header">' +
        '<h1 class="story-details__title">' + escapeHTML(details.title) +
        hostname + '</h1>' +
        '<button class="story-details__close js-close">Close</button>' +
        '<section class="story-details__meta">Posted by ' +
        escapeHTML(details.by) + relativeTime + '</section>' +
        '</header>' +
        '<section class="story-details__content js-content">' +
        visitLink + externalLink +
        '</section>';
  }

  function storyDetailsCommentTemplate(details) {
    var relativeTime = details.time ? ', ' + formatRelative(details.time) : '';

    return '<p class="story-details-comment__author">' +
        escapeHTML(details.by) + relativeTime + '</p>' +
        '<div class="story-details-comment__text">' +
        (details.text || '') + '</div>';
  }

  function normalizeStoryTime(details) {
    if (details && details.time && details.time < 1000000000000)
      details.time *= 1000;
  }

  function onStoryData(key, details) {
    var story = document.getElementById('s-' + key);

    if (!story || !details)
      return;

    normalizeStoryTime(details);
    story.innerHTML = storyTemplate(details);
    story.addEventListener('click', onStoryClick.bind(this, details));
    story.classList.add('clickable');

    scheduleStoryVisualUpdate();
  }

  function onStoryClick(details) {
    var storyDetails = document.getElementById('sd-' + details.id);

    if (!storyDetails)
      storyDetails = createStoryDetails(details);

    showStory(details.id);
  }

  function createStoryDetails(details) {
    var storyDetails;
    var storyHeader;
    var storyContent;
    var commentsElement;
    var closeButton;

    if (details.url) {
      try {
        details.urlobj = new URL(details.url);
      } catch (err) {
        details.urlobj = null;
      }
    }

    storyDetails = document.createElement('section');
    storyDetails.setAttribute('id', 'sd-' + details.id);
    storyDetails.classList.add('story-details');
    storyDetails.innerHTML = storyDetailsTemplate(details);

    document.body.appendChild(storyDetails);

    storyHeader = storyDetails.querySelector('.js-header');
    storyContent = storyDetails.querySelector('.js-content');
    commentsElement = storyDetails.querySelector('.js-comments');
    closeButton = storyDetails.querySelector('.js-close');

    closeButton.addEventListener('click', hideStory.bind(this, details.id));
    storyContent.style.paddingTop =
        storyHeader.getBoundingClientRect().height + 'px';

    if (commentsElement && details.kids && details.kids.length)
      setupCommentLoader(storyContent, commentsElement, details.kids);

    return storyDetails;
  }

  function setupCommentLoader(storyContent, commentsElement, kids) {
    var state = {
      kids: kids,
      next: 0,
      active: 0
    };

    function maybeLoadMoreComments() {
      if (state.active || state.next >= state.kids.length)
        return;

      loadCommentBatch(state, commentsElement, storyContent,
          maybeLoadMoreComments);
    }

    storyContent.addEventListener('scroll', function() {
      var distanceFromBottom = storyContent.scrollHeight -
          storyContent.scrollTop - storyContent.clientHeight;

      if (distanceFromBottom < COMMENT_LOAD_THRESHOLD)
        maybeLoadMoreComments();
    }, { passive: true });

    maybeLoadMoreComments();
  }

  function loadCommentBatch(state, commentsElement, storyContent, onComplete) {
    var end = Math.min(state.next + COMMENT_BATCH_SIZE, state.kids.length);
    var fragment = document.createDocumentFragment();
    var commentIds = state.kids.slice(state.next, end);

    state.next = end;
    state.active = commentIds.length;

    for (var i = 0; i < commentIds.length; i++) {
      var comment = document.createElement('aside');
      comment.setAttribute('id', 'sdc-' + commentIds[i]);
      comment.classList.add('story-details__comment');
      comment.innerHTML = storyDetailsCommentTemplate({
        by: '',
        text: 'Loading comment...'
      });
      fragment.appendChild(comment);
    }

    commentsElement.appendChild(fragment);

    commentIds.forEach(function(commentId) {
      APP.Data.getStoryComment(commentId, function(commentDetails) {
        var comment;

        state.active--;

        if (commentDetails) {
          normalizeStoryTime(commentDetails);
          comment = commentsElement.querySelector('#sdc-' + commentDetails.id);

          if (comment)
            comment.innerHTML = storyDetailsCommentTemplate(commentDetails);
        }

        if (!state.active && storyContent.scrollHeight <=
            storyContent.clientHeight && state.next < state.kids.length) {
          onComplete();
        }
      });
    });
  }

  function showStory(id) {
    var storyDetails = document.getElementById('sd-' + id);

    if (!storyDetails || inDetails)
      return;

    inDetails = true;
    document.body.classList.add('details-active');

    requestAnimationFrame(function() {
      storyDetails.classList.add('story-details--visible');
    });
  }

  function hideStory(id) {
    var storyDetails = document.getElementById('sd-' + id);

    if (!storyDetails || !inDetails)
      return;

    document.body.classList.remove('details-active');
    storyDetails.classList.remove('story-details--visible');

    function finishHide() {
      storyDetails.removeEventListener('transitionend', onTransitionEnd);
      inDetails = false;
    }

    function onTransitionEnd(evt) {
      if (evt.propertyName !== 'transform' &&
          evt.propertyName !== '-webkit-transform') {
        return;
      }

      finishHide();
    }

    storyDetails.addEventListener('transitionend', onTransitionEnd);
    setTimeout(finishHide, 300);
  }

  function scheduleStoryVisualUpdate() {
    if (visualUpdateScheduled)
      return;

    visualUpdateScheduled = true;
    requestAnimationFrame(colorizeAndScaleStories);
  }

  function colorizeAndScaleStories() {
    var storyElements = document.querySelectorAll('.story');
    var mainPosition = main.getBoundingClientRect();
    var mainHeight = main.clientHeight || 1;
    var reads = [];

    visualUpdateScheduled = false;

    for (var s = 0; s < storyElements.length; s++) {
      var story = storyElements[s];
      var storyPosition = story.getBoundingClientRect();

      if (storyPosition.bottom < mainPosition.top - 120 ||
          storyPosition.top > mainPosition.bottom + 120) {
        continue;
      }

      reads.push({
        story: story,
        score: story.querySelector('.story__score'),
        title: story.querySelector('.story__title'),
        top: storyPosition.top - mainPosition.top + 16
      });
    }

    for (var i = 0; i < reads.length; i++) {
      var item = reads[i];
      var scale = Math.max(0.88, Math.min(1,
          1 - (0.05 * ((item.top - 170) / mainHeight))));
      var opacity = Math.max(0.45, Math.min(1,
          1 - (0.5 * ((item.top - 170) / mainHeight))));
      var saturation = Math.round(60 + (scale * 40));

      if (item.score) {
        item.score.style.webkitTransform = 'scale(' + scale + ')';
        item.score.style.transform = 'scale(' + scale + ')';
        item.score.style.backgroundColor = 'hsl(42, ' + saturation + '%, 50%)';
      }

      if (item.title)
        item.title.style.opacity = opacity;
    }
  }

  function scheduleScrollUpdate() {
    if (scrollUpdateScheduled)
      return;

    scrollUpdateScheduled = true;
    requestAnimationFrame(updateForScroll);
  }

  function updateForScroll() {
    var scrollTop = main.scrollTop;
    var scrollTopCapped = Math.min(70, scrollTop);
    var scaleString = 'scale(' + (1 - (scrollTopCapped / 300)) + ')';
    var loadThreshold = main.scrollHeight - main.clientHeight -
        LAZY_LOAD_THRESHOLD;

    scrollUpdateScheduled = false;

    header.style.height = (156 - scrollTopCapped) + 'px';
    headerTitles.style.webkitTransform = scaleString;
    headerTitles.style.transform = scaleString;

    if (scrollTop > 70)
      document.body.classList.add('raised');
    else
      document.body.classList.remove('raised');

    colorizeAndScaleStories();

    if (scrollTop > loadThreshold)
      loadStoryBatch();
  }

  main.addEventListener('scroll', scheduleScrollUpdate, { passive: true });

  function enqueueStoryRequest(id, key, onComplete) {
    storyRequestQueue.push({
      id: id,
      key: key,
      onComplete: onComplete
    });
    pumpStoryRequests();
  }

  function pumpStoryRequests() {
    while (activeStoryRequests < MAX_STORY_REQUESTS &&
        storyRequestQueue.length) {
      var request = storyRequestQueue.shift();
      activeStoryRequests++;

      APP.Data.getStoryById(request.id, function(queuedRequest) {
        return function(details) {
          activeStoryRequests--;
          onStoryData(queuedRequest.key, details);
          queuedRequest.onComplete();
          pumpStoryRequests();
        };
      }(request));
    }
  }

  function loadStoryBatch() {
    var batch;
    var fragment;
    var remaining;
    var completed = 0;

    if (storyBatchLoading || !stories || storyStart >= stories.length)
      return;

    remaining = stories.length - storyStart;
    batch = stories.slice(storyStart, storyStart + Math.min(BATCH_SIZE,
        remaining));
    storyStart += batch.length;
    storyBatchLoading = true;

    fragment = document.createDocumentFragment();

    batch.forEach(function(id) {
      var key = String(id);
      var story = document.createElement('div');

      story.setAttribute('id', 's-' + key);
      story.classList.add('story');
      story.innerHTML = storyTemplate({
        title: '...',
        score: '-',
        by: '...',
        time: 0
      });
      fragment.appendChild(story);
    });

    main.appendChild(fragment);

    batch.forEach(function(id) {
      enqueueStoryRequest(id, String(id), function() {
        completed++;

        if (completed === batch.length) {
          storyBatchLoading = false;
          scheduleStoryVisualUpdate();
        }
      });
    });
  }

  APP.Data.getTopStories(function(data) {
    stories = data || [];
    loadStoryBatch();
    main.classList.remove('loading');
  });

})();
