import { ChainId } from '@pancakeswap/chains'
import { V4_SUPPORTED_CHAINS } from '../../constants/v4'
import { QuoteProvider, QuoterConfig, QuoterOptions, RouteType, RouteWithQuote, RouteWithoutQuote } from '../types'
import { isV3Pool } from '../utils'
import { createOffChainQuoteProvider } from './offChainQuoteProvider'
import {
  createMixedRouteOnChainQuoteProvider,
  createV3OnChainQuoteProvider,
  createV4ClOnChainQuoteProvider,
  createMixedRouteOnChainQuoteProviderV2,
  createV4BinOnChainQuoteProvider,
} from './onChainQuoteProvider'

// For evm
export function createQuoteProvider(config: QuoterConfig): QuoteProvider<QuoterConfig> {
  const { onChainProvider, multicallConfigs, gasLimit } = config
  const offChainQuoteProvider = createOffChainQuoteProvider()
  const mixedRouteOnChainQuoteProviderV1 = createMixedRouteOnChainQuoteProvider({
    onChainProvider,
    multicallConfigs,
    gasLimit,
  })
  const mixedRouteOnChainQuoteProviderV2 = createMixedRouteOnChainQuoteProviderV2({
    onChainProvider,
    multicallConfigs,
    gasLimit,
  })
  const v3OnChainQuoteProvider = createV3OnChainQuoteProvider({ onChainProvider, multicallConfigs, gasLimit })
  const v4ClOnChainQuoteProvider = createV4ClOnChainQuoteProvider({ onChainProvider, multicallConfigs, gasLimit })
  const v4BinOnChainQuoteProvider = createV4BinOnChainQuoteProvider({ onChainProvider, multicallConfigs, gasLimit })

  const createGetRouteWithQuotes = (isExactIn = true) => {
    const getOffChainQuotes = isExactIn
      ? offChainQuoteProvider.getRouteWithQuotesExactIn
      : offChainQuoteProvider.getRouteWithQuotesExactOut
    const getV3Quotes = isExactIn
      ? v3OnChainQuoteProvider.getRouteWithQuotesExactIn
      : v3OnChainQuoteProvider.getRouteWithQuotesExactOut
    const getV4ClQuotes = isExactIn
      ? v4ClOnChainQuoteProvider.getRouteWithQuotesExactIn
      : v4ClOnChainQuoteProvider.getRouteWithQuotesExactOut
    const getV4BinQuotes = isExactIn
      ? v4BinOnChainQuoteProvider.getRouteWithQuotesExactIn
      : v4BinOnChainQuoteProvider.getRouteWithQuotesExactOut
    const createMixedRouteQuoteFetcher = (chainId: ChainId) => {
      const mixedRouteOnChainQuoteProvider = V4_SUPPORTED_CHAINS.includes(chainId)
        ? mixedRouteOnChainQuoteProviderV2
        : mixedRouteOnChainQuoteProviderV1
      return isExactIn
        ? mixedRouteOnChainQuoteProvider.getRouteWithQuotesExactIn
        : mixedRouteOnChainQuoteProvider.getRouteWithQuotesExactOut
    }

    return async function getRoutesWithQuotes(
      routes: RouteWithoutQuote[],
      { blockNumber, gasModel, signal }: QuoterOptions,
    ): Promise<RouteWithQuote[]> {
      const { chainId } = routes[0].input
      const getMixedRouteQuotes = createMixedRouteQuoteFetcher(chainId)

      const v4ClRoutes: RouteWithoutQuote[] = []
      const v4BinRoutes: RouteWithoutQuote[] = []
      const v3SingleHopRoutes: RouteWithoutQuote[] = []
      const v3MultihopRoutes: RouteWithoutQuote[] = []
      const mixedRoutesHaveV3Pool: RouteWithoutQuote[] = []
      const routesCanQuoteOffChain: RouteWithoutQuote[] = []
      for (const route of routes) {
        if (route.type === RouteType.V2 || route.type === RouteType.STABLE) {
          routesCanQuoteOffChain.push(route)
          continue
        }
        if (route.type === RouteType.V3) {
          if (route.pools.length === 1) {
            v3SingleHopRoutes.push(route)
            continue
          }
          v3MultihopRoutes.push(route)
          continue
        }
        if (route.type === RouteType.V4CL) {
          v4ClRoutes.push(route)
          continue
        }
        if (route.type === RouteType.V4BIN) {
          v4BinRoutes.push(route)
          continue
        }
        const { pools } = route
        if (pools.some((pool) => isV3Pool(pool))) {
          mixedRoutesHaveV3Pool.push(route)
          continue
        }
        routesCanQuoteOffChain.push(route)
      }

      const results = await Promise.allSettled([
        getOffChainQuotes(routesCanQuoteOffChain, { blockNumber, gasModel, signal }),
        getMixedRouteQuotes(mixedRoutesHaveV3Pool, { blockNumber, gasModel, retry: { retries: 0 }, signal }),
        getV3Quotes(v3SingleHopRoutes, { blockNumber, gasModel, signal }),
        getV3Quotes(v3MultihopRoutes, { blockNumber, gasModel, retry: { retries: 1 }, signal }),
        getV4ClQuotes(v4ClRoutes, { blockNumber, gasModel, signal }),
        getV4BinQuotes(v4BinRoutes, { blockNumber, gasModel, signal }),
      ])
      if (results.every((result) => result.status === 'rejected')) {
        throw new Error(results.map((result) => (result as PromiseRejectedResult).reason).join(','))
      }
      return results
        .filter((result): result is PromiseFulfilledResult<RouteWithQuote[]> => result.status === 'fulfilled')
        .reduce<RouteWithQuote[]>((acc, cur) => [...acc, ...cur.value], [])
    }
  }

  return {
    getRouteWithQuotesExactIn: createGetRouteWithQuotes(true),
    getRouteWithQuotesExactOut: createGetRouteWithQuotes(false),
    getConfig: () => config,
  }
}
