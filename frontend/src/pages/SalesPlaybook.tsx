import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Phone, MessageSquare, AlertTriangle, CheckCircle2, Copy, ExternalLink, Info, ShieldCheck, Zap, UserCheck } from 'lucide-react'
import { toast } from 'react-hot-toast'

export default function SalesPlaybook() {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copiado al portapapeles')
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Manual Operativo: Endolift®</h1>
          <p className="text-muted mt-1 italic text-sm">NUVANX Medicina Estética Láser — Clínica Premium</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => window.open('https://calendar.app.google/j6U4YiYvJSttNX836', '_blank')}>
            <ExternalLink className="w-4 h-4" />
            Ver Agenda
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-primary" />
              Tono de la Asesora
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-xs text-muted">Cercano, seguro, elegante. Nada agresivo ni demasiado técnico. Transmitir calma y claridad.</p>
          </CardContent>
        </Card>
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Objetivo de Llamada
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-xs text-muted">1. Enviar fotos por WhatsApp para orientación.<br />2. Agendar valoración gratuita directa.</p>
          </CardContent>
        </Card>
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              Definición Core
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-xs text-muted">Láser mínimamente invasivo. No es relleno ni bótox. Busca firmeza, contorno y definición.</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="llamada">
        <TabsList className="mb-4">
          <TabsTrigger value="llamada" className="gap-2">
            <Phone className="w-4 h-4" />
            Guion Llamada
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-2">
            <MessageSquare className="w-4 h-4" />
            WhatsApp
          </TabsTrigger>
          <TabsTrigger value="objeciones" className="gap-2">
            <AlertTriangle className="w-4 h-4" />
            Objeciones
          </TabsTrigger>
          <TabsTrigger value="checklist" className="gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Checklist Diario
          </TabsTrigger>
          <TabsTrigger value="info" className="gap-2">
            <Info className="w-4 h-4" />
            Info Técnica
          </TabsTrigger>
        </TabsList>

        <TabsContent value="llamada" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>1. Apertura y Calificación</CardTitle>
              <CardDescription>Generar interés y entender la necesidad del lead.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted/30 p-4 rounded-lg border-l-4 border-primary">
                <p className="font-semibold mb-2">Saludo e Introducción:</p>
                <p className="italic">"Hola, ¿hablo con [Nombre]? Soy [Tu Nombre] de NUVANX Medicina Estética Láser, en Clínica Chamberí, Madrid. Te llamo porque dejaste tus datos solicitando información sobre Endolift®. ¿Tienes un minuto para que pueda orientarte?"</p>
                <Button variant="ghost" size="sm" className="mt-2 h-7 gap-1 text-[10px]" onClick={() => copyToClipboard('Hola, ¿hablo con [Nombre]? Soy [Tu Nombre] de NUVANX Medicina Estética Láser, en Clínica Chamberí, Madrid. Te llamo porque dejaste tus datos solicitando información sobre Endolift®. ¿Tienes un minuto para que pueda orientarte?')}>
                  <Copy className="w-3 h-3" /> Copiar Saludo
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="font-semibold text-sm uppercase tracking-wider text-muted">Si dice que SÍ:</p>
                  <p className="text-sm bg-muted/20 p-3 rounded">"Perfecto, gracias. La idea no es venderte nada por teléfono, sino entender qué zona te interesa y explicarte si Endolift® podría tener sentido para tu caso."</p>
                </div>
                <div className="space-y-2">
                  <p className="font-semibold text-sm uppercase tracking-wider text-muted">Si NO puede hablar:</p>
                  <p className="text-sm bg-muted/20 p-3 rounded">"Sin problema. Si te parece, te escribo por WhatsApp para que tengas nuestro número guardado y por ahí me cuentas qué zona quieres valorar, envías fotos o agendamos valoración."</p>
                </div>
              </div>

              <div className="space-y-2 pt-4 border-t">
                <p className="font-semibold">Identificación de Zona / Preocupación:</p>
                <p className="text-sm italic text-muted-foreground mb-2">"¿Qué zona te gustaría valorar? ... Si no lo tiene claro: ¿lo que más te preocupa es la flacidez, la grasa localizada, la firmeza, el contorno o la definición?"</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="p-2 border rounded text-xs"><strong>Facial/Cuello:</strong> Papada, perfil mandibular, óvalo facial y cuello. Firmeza y definición natural.</div>
                  <div className="p-2 border rounded text-xs"><strong>Cuerpo:</strong> Abdomen/Flancos. Valorar grasa vs flacidez. Mejorar contorno.</div>
                </div>
              </div>

              <div className="space-y-2 pt-4 border-t">
                <p className="font-semibold">Cualificación (Check rápido):</p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                  <li>¿Zona específica de preocupación?</li>
                  <li>¿Firmeza, contorno o grasa?</li>
                  <li>¿Tratamientos previos en la zona?</li>
                  <li>¿Condiciones médicas (marcapasos, anticoagulantes, embarazo)?</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Cierre y Call-to-Action</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
                <p className="font-semibold text-primary mb-2">Cierre Principal: WhatsApp para Fotos</p>
                <p className="text-sm mb-3">"Lo más práctico ahora es que te escriba por WhatsApp para que tengas nuestro número guardado. Si nos envías fotos claras de la zona, podemos hacer una primera orientación y decirte qué opción podría tener más sentido para ti."</p>
                <Button size="sm" variant="outline" className="gap-2" onClick={() => copyToClipboard('Lo más práctico ahora es que te escriba por WhatsApp para que tengas nuestro número guardado. Si nos envías fotos claras de la zona, podemos hacer una primera orientación y decirte qué opción podría tener más sentido para ti. ¿Te escribo ahora por WhatsApp?')}>
                  <Copy className="w-3 h-3" /> Copiar Cierre Principal
                </Button>
              </div>

              <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
                <p className="font-semibold text-primary mb-2">Cierre Alternativo: Agenda Directa</p>
                <p className="text-sm mb-3">"Si lo prefieres, también puedes agendar directamente tu valoración gratuita para que el doctor revise tu caso en clínica. Te envío ahora el enlace para que elijas el horario."</p>
                <Button size="sm" variant="outline" className="gap-2" onClick={() => copyToClipboard('Si lo prefieres, también puedes agendar directamente tu valoración gratuita para que el doctor revise tu caso en clínica. Te envío ahora el enlace para que elijas el horario que mejor te venga: https://calendar.app.google/j6U4YiYvJSttNX836')}>
                  <Copy className="w-3 h-3" /> Copiar Cierre Agenda
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="whatsapp" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Plantilla General (Fotos)</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap font-sans text-muted-foreground mb-3">
{`Hola, [Nombre]. Soy [Tu Nombre] de NUVANX Medicina Estética Láser.
Como comentamos, puedes enviarnos por este WhatsApp fotos claras de la zona que deseas valorar para darte una primera orientación.

Idealmente, envíanos:
- Foto de frente
- Foto de perfil derecho
- Foto de perfil izquierdo
- Foto adicional de la zona que más preocupa

Con buena luz, sin filtros y con postura natural.

Si lo prefieres, agenda valoración gratuita aquí:
https://calendar.app.google/j6U4YiYvJSttNX836`}
                </pre>
                <Button className="w-full gap-2" size="sm" onClick={() => copyToClipboard(`Hola, [Nombre]. Soy [Tu Nombre] de NUVANX Medicina Estética Láser.\nComo comentamos, puedes enviarnos por este WhatsApp fotos claras de la zona que deseas valorar para darte una primera orientación.\n\nIdealmente, envíanos:\n- Foto de frente\n- Foto de perfil derecho\n- Foto de perfil izquierdo\n- Una foto adicional de la zona que más te preocupa\nCon buena luz, sin filtros y con postura natural.\n\nSi lo prefieres, también puedes agendar directamente tu valoración gratuita aquí: https://calendar.app.google/j6U4YiYvJSttNX836\n\nQuedamos atentos.`)}>
                  <Copy className="w-3 h-3" /> Copiar Plantilla
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">No Contesta Llamada</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap font-sans text-muted-foreground mb-3">
{`Hola, [Nombre]. Soy [Tu Nombre] de NUVANX Medicina Estética Láser.
Hemos intentado llamarte porque nos dejaste tus datos solicitando información sobre Endolift®.

Si te parece, puedes respondernos por este WhatsApp indicándonos qué zona deseas valorar. Si quieres, también puedes enviarnos fotos claras para una primera orientación.

O agenda directamente tu valoración gratuita aquí:
https://calendar.app.google/j6U4YiYvJSttNX836`}
                </pre>
                <Button className="w-full gap-2" size="sm" onClick={() => copyToClipboard(`Hola, [Nombre]. Soy [Tu Nombre] de NUVANX Medicina Estética Láser.\nHemos intentado llamarte porque nos dejaste tus datos solicitando información sobre Endolift®.\n\nSi te parece, puedes respondernos por este WhatsApp indicándonos qué zona deseas valorar. Si quieres, también puedes enviarnos fotos claras para darte una primera orientación.\n\nY si te resulta más cómodo, también puedes agendar directamente tu valoración gratuita aquí: https://calendar.app.google/j6U4YiYvJSttNX836\n\nQuedamos atentos.`)}>
                  <Copy className="w-3 h-3" /> Copiar Plantilla
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Papada / Cuello</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap font-sans text-muted-foreground mb-3">
{`Hola, [Nombre]. Soy [Tu Nombre] de NUVANX...
Como comentamos, envíanos fotos de papada, cuello y perfil mandibular:
- Frente (rostro y cuello)
- Perfil derecho e izquierdo
- Mirando ligeramente hacia abajo
Pelo recogido y cámara a la altura del rostro.`}
                </pre>
                <Button className="w-full gap-2" size="sm" onClick={() => copyToClipboard(`Hola, [Nombre]. Soy [Tu Nombre] de NUVANX Medicina Estética Láser.\nComo comentamos, puedes enviarnos por este WhatsApp fotos claras de papada, cuello y perfil mandibular para darte una primera orientación.\n\nPor favor, envíanos:\n- Foto de frente, con rostro y cuello visibles\n- Foto de perfil derecho\n- Foto de perfil izquierdo\n- Foto mirando ligeramente hacia abajo\n- Una foto adicional de la zona que más te preocupa\nLo ideal es que sean con buena luz, sin filtros, con el cabello recogido y la cámara a la altura del rostro.\n\nAgenda aquí: https://calendar.app.google/j6U4YiYvJSttNX836`)}>
                  <Copy className="w-3 h-3" /> Copiar Plantilla
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Abdomen / Flancos</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap font-sans text-muted-foreground mb-3">
{`Hola, [Nombre]. Soy [Tu Nombre] de NUVANX...
Valoramos abdomen inferior y flancos para definir silueta.
Envíanos fotos claras:
- Frente (pecho a cadera)
- Perfil derecho e izquierdo
- Espalda / 3/4 posterior
Ropa ajustada y de pie.`}
                </pre>
                <Button className="w-full gap-2" size="sm" onClick={() => copyToClipboard(`Hola, [Nombre]. Soy [Tu Nombre] de NUVANX Medicina Estética Láser.\nComo comentamos, podemos valorar abdomen inferior y flancos para ayudarte a definir mejor la silueta.\n\nSi te parece, envíanos por este WhatsApp unas fotos claras:\n- De frente, desde debajo del pecho hasta la cadera\n- De perfil derecho\n- De perfil izquierdo\n- De espalda o 3/4 posterior, donde se vean los flancos\n- Una foto adicional de la zona que más te preocupa\nLo ideal es que sean con buena luz, sin filtros, de pie y con ropa ajustada.\n\nAgenda aquí: https://calendar.app.google/j6U4YiYvJSttNX836`)}>
                  <Copy className="w-3 h-3" /> Copiar Plantilla
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="objeciones" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { q: "¿Cuánto cuesta?", a: "El precio depende de la zona y de lo que realmente se necesite tratar. Para no darte una cifra equivocada, primero necesitamos saber qué zona deseas valorar y, si puedes, revisar fotos. Con eso sí podemos darte una primera orientación." },
              { q: "¿Duele?", a: "Normalmente se utilizan medidas de confort y anestesia local según la zona. Eso lo confirma el doctor en la valoración, porque depende del área a tratar y de cada caso." },
              { q: "¿Es cirugía?", a: "No es una cirugía tradicional ni una liposucción quirúrgica. Es un procedimiento láser mínimamente invasivo, pero igualmente requiere valoración médica previa." },
              { q: "No quiero rellenos", a: "Endolift® NO es un relleno. No aporta volumen ni cambia las facciones; está orientado a trabajar firmeza y definición de forma natural." },
              { q: "Me da miedo", a: "Es totalmente normal. Por eso siempre trabajamos con una valoración médica previa, para ver si realmente eres candidata y explicarte todo con claridad." },
              { q: "¿La valoración es gratis?", a: "Sí, la valoración es totalmente gratuita e informativa. Si quieres, te envío el enlace para que elijas el horario que mejor te venga." }
            ].map((obj) => (
              <Card key={obj.q}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold text-primary">"{obj.q}"</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs italic text-muted-foreground mb-2">"{obj.a}"</p>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-[10px]" onClick={() => copyToClipboard(obj.a)}>
                    <Copy className="w-3 h-3" /> Copiar Respuesta
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="checklist" className="space-y-4">
          <Card className="border-green-500/20 bg-green-500/5">
            <CardHeader>
              <CardTitle className="text-green-600 dark:text-green-400">Checklist Ultra-Corta Operativa</CardTitle>
              <CardDescription>Para el flujo diario de la asesora.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <p className="font-bold text-sm border-b pb-1">En la Llamada:</p>
                <ul className="space-y-2">
                  <li className="flex items-center gap-2 text-xs"><CheckCircle2 className="w-3 h-3 text-green-500" /> Saludar y confirmar datos.</li>
                  <li className="flex items-center gap-2 text-xs"><CheckCircle2 className="w-3 h-3 text-green-500" /> Preguntar por la zona de interés.</li>
                  <li className="flex items-center gap-2 text-xs"><CheckCircle2 className="w-3 h-3 text-green-500" /> Explicar Endolift en 2 frases (No relleno/bótox).</li>
                  <li className="flex items-center gap-2 text-xs"><CheckCircle2 className="w-3 h-3 text-green-500" /> Hacer 3-4 preguntas rápidas de salud/historial.</li>
                  <li className="flex items-center gap-2 text-xs"><CheckCircle2 className="w-3 h-3 text-green-500" /> Cerrar a WhatsApp o Agenda Directa.</li>
                </ul>
              </div>
              <div className="space-y-4">
                <p className="font-bold text-sm border-b pb-1">Si No Contesta:</p>
                <ul className="space-y-2">
                  <li className="flex items-center gap-2 text-xs"><CheckCircle2 className="w-3 h-3 text-green-500" /> Enviar WhatsApp corto inmediatamente.</li>
                  <li className="flex items-center gap-2 text-xs"><CheckCircle2 className="w-3 h-3 text-green-500" /> Recordar motivo del contacto.</li>
                  <li className="flex items-center gap-2 text-xs"><CheckCircle2 className="w-3 h-3 text-green-500" /> Pedir zona o fotos.</li>
                  <li className="flex items-center gap-2 text-xs"><CheckCircle2 className="w-3 h-3 text-green-500" /> Incluir link de agenda.</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="info" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Info Técnica para Ventas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-3 bg-muted rounded-lg text-center">
                  <p className="text-[10px] text-muted uppercase font-bold">Tecnología</p>
                  <p className="text-sm font-semibold">Láser de Diodo</p>
                </div>
                <div className="p-3 bg-muted rounded-lg text-center">
                  <p className="text-[10px] text-muted uppercase font-bold">Tipo</p>
                  <p className="text-sm font-semibold">Mínimamente Invasivo</p>
                </div>
                <div className="p-3 bg-muted rounded-lg text-center">
                  <p className="text-[10px] text-muted uppercase font-bold">Valoración</p>
                  <p className="text-sm font-semibold text-green-600">Gratuita</p>
                </div>
              </div>

              <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex gap-3">
                <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                <div className="text-xs text-yellow-700 dark:text-yellow-400">
                  <p className="font-bold mb-1 uppercase tracking-tighter text-[10px]">Red Flags (No confirmar tratamiento):</p>
                  <p>Marcapasos, embarazo actual, anticoagulantes o cirugías muy recientes en la zona. <strong>Derivar a valoración médica.</strong></p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="font-semibold text-sm">Resumen de Recomendación:</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Para mantener velocidad y consistencia, usa siempre los 3 activos:
                  <br />- <strong>Guion de Llamada</strong> para estandarizar el primer contacto.
                  <br />- <strong>Plantillas de WhatsApp</strong> rápidas para pedir fotos.
                  <br />- <strong>Link de Agenda</strong> siempre a mano para cerrar la cita.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
