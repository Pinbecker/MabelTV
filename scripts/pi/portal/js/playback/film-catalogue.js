'use strict'

    let watchGenre = ''

    function filmGenres(film) {
      return Array.isArray(film.metadata?.genres)
        ? film.metadata.genres.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim())
        : []
    }

    function renderFilmFilters(films) {
      const folders = [...new Set([...(library?.adult_folders || []), ...films.map(film => film.folder || '').filter(Boolean)])]
        .sort((a, b) => a.localeCompare(b))
      const genres = [...new Set(films.flatMap(filmGenres))].sort((a, b) => a.localeCompare(b))
      if (watchFolder !== '*' && watchFolder !== '' && !folders.includes(watchFolder)) watchFolder = '*'
      if (watchGenre && !genres.includes(watchGenre)) watchGenre = ''
      const collections = [{ value: '*', label: 'All collections' }, { value: '', label: 'Unfiled' },
        ...folders.map(value => ({ value, label: value }))]
      const genreOptions = [{ value: '', label: 'All genres' }, ...genres.map(value => ({ value, label: value }))]
      for (const [id, options, selected] of [
        ['#watchCollectionFilter', collections, watchFolder], ['#watchGenreFilter', genreOptions, watchGenre],
      ]) {
        const select = $(id)
        const unchanged = select.options.length === options.length && options.every(({ value, label }, index) =>
          select.options[index].value === value && select.options[index].textContent === label)
        if (!unchanged) select.replaceChildren(...options.map(({ value, label }) => {
          const option = document.createElement('option'); option.value = value; option.textContent = label
          return option
        }))
        select.value = selected
      }
    }

    $('#watchCollectionFilter').onchange = event => { watchFolder = event.target.value; renderAdultWatch() }
    $('#watchGenreFilter').onchange = event => { watchGenre = event.target.value; renderAdultWatch() }

    function renderAdultWatch() {
      return preservePortalPosition(renderAdultFilmCatalogue, { anchor: false })
    }

    function renderAdultFilmCatalogue() {
      const adult = $('#remoteAdult')
      const allFilms = [...(library?.adult_library || [])].sort((left, right) => watchFilmTitle(left).localeCompare(watchFilmTitle(right), undefined, { sensitivity: 'base' }))
      renderFilmFilters(allFilms)
      $('#watchSearch').value = watchSearchText
      $('#watchSearchClear').classList.toggle('hidden', !watchSearchText)

      const query = watchSearchText.trim().toLocaleLowerCase()
      renderAdultSeries(watchSearchText)
      const resumableFilms = allFilms
        .filter(film => film.browser_ready !== false && watchFilmResumable(film))
        .map(film => ({ ...adultFilmEntry(film),
          lastWatched: Number(film.remote_last_watched || 0) }))
      const resumable = [...resumableFilms, ...adultSeriesContinueEntries()]
        .sort((left, right) => Number(right.lastWatched || 0) - Number(left.lastWatched || 0))
        .slice(0, 10)
      const continueSection = $('#watchContinueSection')
      continueSection.classList.toggle('hidden', !resumable.length || Boolean(query))
      $('#watchContinueCount').textContent = resumable.length ? `${resumable.length} in progress` : ''
      const continueRail = $('#watchContinueRail')
      continueRail.innerHTML = ''
      resumable.forEach(entry => continueRail.append(continueWatchCard(entry)))

      const films = allFilms.filter(film => {
        if (watchFolder !== '*' && (film.folder || '') !== watchFolder) return false
        if (watchGenre && !filmGenres(film).includes(watchGenre)) return false
        if (!query) return true
        const metadata = film.metadata || {}
        return [watchFilmTitle(film), film.display_name, film.folder, metadata.year].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)
      })
      $('#watchLibraryKicker').textContent = query ? 'Film results' : 'Your library'
      $('#watchLibraryTitle').textContent = query ? `“${watchSearchText.trim()}”` : watchFolder === '*' ? 'All films' : watchFolder || 'Unfiled'
      $('#watchLibraryCount').textContent = `${films.length} film${films.length === 1 ? '' : 's'}`
      const grid = document.createElement('div')
      grid.className = 'watch-poster-grid'
      films.forEach(film => grid.append(adultWatchCard(film)))
      if (!films.length) {
        grid.append(portalEmptyState({
          className: 'watch-empty', title: allFilms.length ? 'No matching films' : 'No films yet',
          message: allFilms.length ? 'Choose another collection or genre, or clear your search.' : 'Add a film to start your library.',
        }))
      }
      adult.replaceChildren(grid)
    }
