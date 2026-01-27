'use strict';
var LANGUAGE_SWITCHER_CLASS = '.language-switcher';
var LANGUAGE_SWITCHER = document.querySelectorAll(LANGUAGE_SWITCHER_CLASS);

//dropdown menu fxn
if (LANGUAGE_SWITCHER) {

  /**
   * TODO: Change the Damn language picker lol SEARCH-4576
   */
  $( 'span.cutoff' )
    .parentsUntil( LANGUAGE_SWITCHER_CLASS ).click(function (evt) {
    evt.stopPropagation();

    [].forEach.call(LANGUAGE_SWITCHER, function(div) {
      // do whatever
      div.classList.toggle('open');
    });
  });

} else {
  console.log('NO language-switcher-container')
}