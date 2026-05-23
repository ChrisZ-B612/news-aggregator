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
(function () {
    const throttleInRAF = (() => {
        var callbacks = new Set();
        var isFired = false;

        return (fn) => () => {
            callbacks.add(fn);

            if (!isFired) {
                isFired = true;
                requestAnimationFrame(() => {
                    // 支持 callback 再次调用 throttleInRAF，不过这里简单点直接安排到下一帧了
                    var list = Array.from(callbacks);
                    callbacks.clear();
                    isFired = false;

                    list.forEach((callback) => callback());
                });
            }
        };
    })();

    var LAZY_LOAD_THRESHOLD = 300;
    var $ = document.querySelector.bind(document);

    var stories = null;
    var storyStart = 0;
    var count = 30;
    var main = $('main');
    var inDetails = false;
    var localeData = {
        data: {
            intl: {
                locales: 'en-US'
            }
        }
    };

    // IntersectionObserver for visible stories
    var visibleStories = new Set();
    var loadedStoryIds = new Set();
    var storyObserver = new IntersectionObserver((entries) => {
        entries.forEach(({ isIntersecting, target }) => {
            if (isIntersecting) {
                visibleStories.add(target);

                var id = target.dataset.id;
                if (!loadedStoryIds.has(id)) {
                    APP.Data.getStoryById(id, onStoryData.bind(this, id));
                    loadedStoryIds.add(id);
                }
            } else {
                visibleStories.delete(target);
            }

            colorizeAndScaleStories();
        });
    }, {
        root: main,
        rootMargin: '100px',
        threshold: 0
    });

    var tmplStory = $('#tmpl-story').textContent;
    var tmplStoryDetails = $('#tmpl-story-details').textContent;
    var tmplStoryDetailsComment = $('#tmpl-story-details-comment').textContent;

    if (typeof HandlebarsIntl !== 'undefined') {
        HandlebarsIntl.registerWith(Handlebars);
    } else {

        // Remove references to formatRelative, because Intl isn't supported.
        var intlRelative = /, {{ formatRelative time }}/;
        tmplStory = tmplStory.replace(intlRelative, '');
        tmplStoryDetails = tmplStoryDetails.replace(intlRelative, '');
        tmplStoryDetailsComment = tmplStoryDetailsComment.replace(intlRelative, '');
    }

    var storyTemplate =
        Handlebars.compile(tmplStory);
    var storyDetailsTemplate =
        Handlebars.compile(tmplStoryDetails);
    var storyDetailsCommentTemplate =
        Handlebars.compile(tmplStoryDetailsComment);

    var loadedStories = new Set();

    /**
     * As every single story arrives in shove its
     * content in at that exact moment. Feels like something
     * that should really be handled more delicately, and
     * probably in a requestAnimationFrame callback.
     */
    function onStoryData(key, details) {

        // This seems odd. Surely we could just select the story
        // directly rather than looping through all of them.
        var story = document.getElementById('s-' + key);

        if (story) {
            details.time *= 1000;
            var index = story.dataset.index;
            story.innerHTML = storyTemplate({ ...details, index });
            story.addEventListener('click', onStoryClick.bind(this, details));
            story.dataset.loaded = true;

            loadedStories.add(story);

            colorizeAndScaleStories();
        }
    }

    var storyDetails;

    function getStoryComment(commentDetails) {
        commentDetails.time *= 1000;
        this.innerHTML = storyDetailsCommentTemplate(
            commentDetails,
            localeData);
    }

    function onStoryClick(details) {
        // Create and append the story. A visual change...
        // perhaps that should be in a requestAnimationFrame?
        // And maybe, since they're all the same, I don't
        // need to make a new element every single time? I mean,
        // it inflates the DOM and I can only see one at once.
        if (!storyDetails) {
            storyDetails = document.createElement('section');
            storyDetails.classList.add('story-details');
            document.body.appendChild(storyDetails);
        }

        showStory();

        if (details.url)
            details.urlobj = new URL(details.url);

        var commentsElement;
        var storyHeader;
        var storyContent;

        var storyDetailsHtml = storyDetailsTemplate(details);
        var kids = details.kids;
        var commentHtml = storyDetailsCommentTemplate({
            by: '', text: 'Loading comment...'
        });

        storyDetails.innerHTML = storyDetailsHtml;

        commentsElement = storyDetails.querySelector('.js-comments');
        storyHeader = storyDetails.querySelector('.js-header');
        storyContent = storyDetails.querySelector('.js-content');

        var closeButton = storyDetails.querySelector('.js-close');
        closeButton.addEventListener('click', hideStory);

        var headerHeight = storyHeader.getBoundingClientRect().height;
        storyContent.style.paddingTop = headerHeight + 'px';

        if (typeof kids === 'undefined')
            return;

        var fragment = document.createDocumentFragment();
        for (var k = 0; k < kids.length; k++) {
            var kid = kids[k];
            var comment = document.createElement('aside');
            comment.setAttribute('id', 'sdc-' + kid);
            comment.classList.add('story-details__comment');
            comment.innerHTML = commentHtml;
            fragment.appendChild(comment);

            // Update the comment with the live data.
            APP.Data.getStoryComment(kid, getStoryComment.bind(comment));
        }
        commentsElement.appendChild(fragment);
    }

    function showStory() {
        if (inDetails || !storyDetails)
            return;

        inDetails = true;
        storyDetails.classList.add('show');
    }

    function hideStory() {
        if (!inDetails || !storyDetails)
            return;

        inDetails = false;
        storyDetails.classList.remove('show');
    }

    /**
     * Does this really add anything? Can we do this kind
     * of work in a cheaper way?
     */
    var colorizeAndScaleStories = throttleInRAF(function () {
        var mainHeight = main.offsetHeight;
        var storyElements = Array.from(loadedStories).filter((story) => visibleStories.has(story));

        // Avoid forcing a synchronous layout by doing all the reads first, then the writes.
        var infos = storyElements.map((story) => {
            // Base the scale on the y position of the score.
            var score = story.querySelector('.story__score');
            var scoreTop = score.getBoundingClientRect().top;
            var scale = Math.min(1, 1 - (0.05 * ((scoreTop - 170) / mainHeight)));
            var opacity = Math.min(1, 1 - (0.5 * ((scoreTop - 170) / mainHeight)));

            return { scale, opacity };
        });

        // It does seem awfully broad to change all the
        // colors every time!
        for (var s = 0; s < storyElements.length; s++) {
            var story = storyElements[s];
            var score = story.querySelector('.story__score');
            var title = story.querySelector('.story__title');
            var { scale, opacity } = infos[s];

            var num = scale * 40;
            score.style.width = num + 'px';
            score.style.height = num + 'px';
            score.style.lineHeight = num + 'px';

            // Now figure out how wide it is and use that to saturate it.
            var saturation = (100 * ((num - 38) / 2));

            score.style.backgroundColor = 'hsl(42, ' + saturation + '%, 50%)';

            title.style.opacity = opacity;
        }
    });

    main.addEventListener('touchstart', function (evt) {

        // I just wanted to test what happens if touchstart
        // gets canceled. Hope it doesn't block scrolling on mobiles...
        if (Math.random() > 0.97) {
            evt.preventDefault();
        }

    });

    var onScroll = throttleInRAF(function onScroll() {
        var mainScrollTop = main.scrollTop;
        var scrollTopCapped = Math.min(70, mainScrollTop);
        var header = $('header');
        var headerTitles = header.querySelector('.header__title-wrapper');
        var scaleString = 'scale(' + (1 - (scrollTopCapped / 300)) + ')';

        header.style.height = (156 - scrollTopCapped) + 'px';
        headerTitles.style.webkitTransform = scaleString;
        headerTitles.style.transform = scaleString;

        document.body.classList.toggle('raised', mainScrollTop > 70);

        // Check if we need to load the next batch of stories.
        var loadThreshold = (main.scrollHeight - main.offsetHeight -
            LAZY_LOAD_THRESHOLD);
        if (mainScrollTop > loadThreshold)
            loadStoryBatch();
    });

    main.addEventListener('scroll', onScroll);

    function loadStoryBatch() {
        var fragment = document.createDocumentFragment();
        var end = storyStart + count;

        for (var i = storyStart; i < end; i++) {
            if (i >= stories.length)
                return;

            var id = String(stories[i]);
            var story = document.createElement('div');
            story.setAttribute('id', 's-' + id);
            story.dataset.id = id;
            story.dataset.index = i;
            story.classList.add('story');
            story.innerHTML = storyTemplate({
                title: '...',
                score: '-',
                by: '...',
                time: 0,
                index: i,
            });

            fragment.appendChild(story);

            // Observe the story for visibility changes
            storyObserver.observe(story);
        }

        main.appendChild(fragment);

        storyStart += count;

    }

    // Bootstrap in the stories.
    APP.Data.getTopStories(function (data) {
        stories = data;
        loadStoryBatch();
        main.classList.remove('loading');
    });

})();
