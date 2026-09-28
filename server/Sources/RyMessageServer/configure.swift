import Vapor

func configure(_ app: Application) throws {
    var config = try ConfigStore.loadOrCreate()
    if let override = Environment.get("RYMESSAGE_TOKEN"), !override.isEmpty {
        config.token = override
    }

    app.http.server.configuration.hostname = "0.0.0.0"
    app.http.server.configuration.port = config.port

    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    ContentConfiguration.global.use(encoder: encoder, for: .json)
    ContentConfiguration.global.use(decoder: decoder, for: .json)

    app.middleware = Middlewares()
    let corsOrigins: CORSMiddleware.AllowOriginSetting =
        config.allowedOrigins.map { .any($0) } ?? .all
    app.middleware.use(
        CORSMiddleware(
            configuration: .init(
                allowedOrigin: corsOrigins,
                allowedMethods: [.GET, .POST, .OPTIONS],
                allowedHeaders: [.authorization, .contentType]
            )
        )
    )
    app.middleware.use(RouteLoggingMiddleware(logLevel: .info))
    app.middleware.use(ApiErrorMiddleware())

    let provider = ChatDBProvider(logger: app.logger)
    let hub = EventHub()
    try routes(app, provider: provider, hub: hub, token: config.token)
    provider.startWatching(hub: hub, logger: app.logger)

    // the pairing code contains the token, so keep it out of the background service's log file
    if isatty(STDOUT_FILENO) != 0 {
        Pairing.printInstructions(config: config)
    } else {
        app.logger.info("Listening on port \(config.port). Show the pairing code with: rymessage-server --pairing-code")
    }
}
