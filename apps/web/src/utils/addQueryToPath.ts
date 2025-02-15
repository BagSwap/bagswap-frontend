export function addQueryToPath(path: string, queryParams: { [key: string]: string }) {
  const [pathname, search] = path.split('?')
  const searchParams = new URLSearchParams(search)

  Object.keys(queryParams).forEach((key) => {
    if (key === 'chain') {
      searchParams.delete('chainId')
    } else {
      searchParams.set(key, queryParams[key])
    }
  })

  return `${pathname}?${searchParams.toString()}`
}
